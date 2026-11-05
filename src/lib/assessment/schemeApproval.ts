import { prisma } from "@/lib/prisma";
import { isSchemeApproved, schemeOf, validateCriteria } from "@/lib/scheme/criteria";

/**
 * A teacher approves a marking scheme before anything is marked against it
 * (decision D8 of 06-correction-hardening-plan.md). The AI drafts; the teacher
 * decides. Approval records who and when on the version itself.
 *
 * Ownership is checked in the query, never trusted from the caller. A scheme
 * whose criteria do not add up to the question's marks cannot be approved: the
 * teacher is told what to fix, and nothing is changed.
 */

export type ApprovalCode = "NOT_FOUND" | "NO_SCHEME" | "SCHEME_INVALID";

export type ApproveOneResult =
  | { ok: true; alreadyApproved: boolean; versionId: string }
  | { ok: false; code: ApprovalCode; message: string };

export async function approveScheme(input: { teacherId: string; questionId: string }): Promise<ApproveOneResult> {
  const question = await prisma.question.findFirst({
    where: { id: input.questionId, assessment: { teacherId: input.teacherId } },
    select: {
      maximumMarks: true,
      rubric: {
        select: {
          activeVersionId: true,
          activeVersion: {
            select: {
              id: true,
              approvedAt: true,
              criteria: true,
              markingCheckpoints: true,
              followThrough: true,
              noWorkingRule: true,
              acceptedAlternatives: true,
            },
          },
        },
      },
    },
  });
  if (!question) return { ok: false, code: "NOT_FOUND", message: "Question not found." };

  const version = question.rubric?.activeVersion;
  if (!version) return { ok: false, code: "NO_SCHEME", message: "This question has no marking scheme to approve yet." };
  if (isSchemeApproved(version)) return { ok: true, alreadyApproved: true, versionId: version.id };

  const maximumMarks = Number(question.maximumMarks);
  const check = validateCriteria(schemeOf(version, maximumMarks).criteria, maximumMarks);
  if (!check.ok) {
    return { ok: false, code: "SCHEME_INVALID", message: check.errors[0] ?? "The marking scheme is not valid." };
  }

  // Conditional, so two clicks (or two tabs) approve once and the second reports "already approved".
  const written = await prisma.rubricVersion.updateMany({
    where: { id: version.id, approvedAt: null },
    data: { approvedAt: new Date(), approvedById: input.teacherId, status: "ACTIVE" },
  });
  return { ok: true, alreadyApproved: written.count === 0, versionId: version.id };
}

export interface ApproveAllResult {
  approved: number;
  alreadyApproved: number;
  skipped: { questionNumber: number; message: string }[];
  /** Question ids whose scheme was newly approved, so held answers can be picked up. */
  newlyApprovedQuestionIds: string[];
}

export async function approveAllSchemes(input: { teacherId: string; assessmentId: string }): Promise<ApproveAllResult | null> {
  const assessment = await prisma.assessment.findFirst({
    where: { id: input.assessmentId, teacherId: input.teacherId },
    select: { questions: { orderBy: { questionNumber: "asc" }, select: { id: true, questionNumber: true } } },
  });
  if (!assessment) return null;

  const result: ApproveAllResult = { approved: 0, alreadyApproved: 0, skipped: [], newlyApprovedQuestionIds: [] };
  for (const question of assessment.questions) {
    const outcome = await approveScheme({ teacherId: input.teacherId, questionId: question.id });
    if (!outcome.ok) {
      result.skipped.push({ questionNumber: question.questionNumber, message: outcome.message });
    } else if (outcome.alreadyApproved) {
      result.alreadyApproved++;
    } else {
      result.approved++;
      result.newlyApprovedQuestionIds.push(question.id);
    }
  }
  return result;
}
