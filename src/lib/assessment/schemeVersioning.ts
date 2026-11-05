import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Every change a teacher makes to a marking scheme is saved as a NEW version,
 * never edited in place, so what an answer was marked against is always
 * recoverable. The teacher saving a version is the approval of it (they wrote or
 * reviewed it): it carries their id and the time, and becomes the active version
 * in the same transaction so the database's active-version foreign key always holds.
 *
 * Every field of the previous version is carried forward unless a change says
 * otherwise. The manual editor used to rebuild the version from scratch and
 * silently dropped the expected answer, the partial-credit guidance and the
 * structured expectation.
 */

export interface VersionChanges {
  solutionApproaches?: unknown;
  markingCheckpoints?: unknown;
  criteria?: unknown;
  followThrough?: "ALLOWED" | "NOT_ALLOWED" | "METHOD_ONLY" | null;
  noWorkingRule?: "FINAL_ANSWER_ONLY" | "FULL_MARKS" | null;
  acceptedAlternatives?: string[] | null;
  acceptPercent?: boolean;
  decimalComma?: boolean;
}

export type SaveVersionResult = { ok: true; versionId: string } | { ok: false; message: string };

const asJson = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

export async function saveSchemeVersion(input: {
  teacherId: string;
  questionId: string;
  changes: VersionChanges;
}): Promise<SaveVersionResult> {
  const question = await prisma.question.findFirst({
    where: { id: input.questionId, assessment: { teacherId: input.teacherId } },
    select: { id: true },
  });
  if (!question) return { ok: false, message: "Question not found." };

  const versionId = await prisma.$transaction(async (tx) => {
    let rubric = await tx.rubric.findUnique({ where: { questionId: input.questionId }, include: { activeVersion: true } });
    if (!rubric) rubric = await tx.rubric.create({ data: { questionId: input.questionId }, include: { activeVersion: true } });

    const base = rubric.activeVersion;
    const highest = await tx.rubricVersion.aggregate({ where: { rubricId: rubric.id }, _max: { versionNumber: true } });
    const c = input.changes;
    const pick = <K extends keyof VersionChanges>(key: K, fallback: unknown) => (key in c ? c[key] : fallback);

    const created = await tx.rubricVersion.create({
      data: {
        rubricId: rubric.id,
        versionNumber: (highest._max.versionNumber ?? 0) + 1,
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedById: input.teacherId,
        solutionApproaches: asJson(pick("solutionApproaches", base?.solutionApproaches)),
        markingCheckpoints: asJson(pick("markingCheckpoints", base?.markingCheckpoints)),
        criteria: asJson(pick("criteria", base?.criteria)),
        followThrough: (pick("followThrough", base?.followThrough) as VersionChanges["followThrough"]) ?? null,
        noWorkingRule: (pick("noWorkingRule", base?.noWorkingRule) as VersionChanges["noWorkingRule"]) ?? null,
        acceptedAlternatives: asJson(pick("acceptedAlternatives", base?.acceptedAlternatives)),
        acceptPercent: pick("acceptPercent", base?.acceptPercent) === true,
        decimalComma: pick("decimalComma", base?.decimalComma) === true,
        // Carried forward untouched: the editor never knew about these.
        expectedAnswer: base?.expectedAnswer ?? null,
        partialCreditGuidance: base?.partialCreditGuidance ?? null,
        structuredExpectation: asJson(base?.structuredExpectation),
      },
    });

    if (rubric.activeVersionId) {
      await tx.rubricVersion.update({ where: { id: rubric.activeVersionId }, data: { status: "SUPERSEDED" } });
    }
    await tx.rubric.update({
      where: { id: rubric.id },
      data: { activeVersionId: created.id, generationStatus: "READY", generationError: null },
    });
    return created.id;
  });

  return { ok: true, versionId };
}
