import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { recalculateSubmissionStatus } from "@/lib/assessment/submissionStatusSync";
import { parseGradingResult } from "@/lib/pipeline/parseResults";

/**
 * When a marking scheme is approved or edited after answers were drafted
 * against it (decision D13 of 06-correction-hardening-plan.md):
 *
 *   - an answer the AI drafted and no teacher has touched is marked again;
 *   - an answer a teacher has already accepted or changed, or one in a
 *     submission they confirmed, is NEVER overwritten — the teacher is told the
 *     scheme changed, and decides;
 *   - everything else (still being marked, flagged for another reason) is left alone.
 */

export type ReapplyAction = "RERUN" | "FLAG_CHANGED" | "LEAVE";

export interface ReapplyInput {
  status: string;
  gradingResult: unknown;
  submissionConfirmed: boolean;
  /** An open "scheme not approved" flag is parked against this answer. */
  heldForScheme: boolean;
}

export function reapplyAction(input: ReapplyInput): ReapplyAction {
  // A confirmed submission, or a mark a teacher has accepted or changed, is the teacher's, not the AI's.
  if (input.submissionConfirmed) return "FLAG_CHANGED";
  if (parseGradingResult(input.gradingResult)?.teacherReview) return "FLAG_CHANGED";

  if (input.heldForScheme) return "RERUN";
  if (input.status === "GRADED") return "RERUN";
  return "LEAVE";
}

export interface ReapplyOutcome {
  rerun: number;
  flagged: number;
  left: number;
}

type Runner = (submissionId: string) => Promise<void>;

/**
 * Re-applies a question's current scheme. `runSubmission` is how a submission's
 * waiting answers are marked (the route chosen by the caller), injected so this
 * module needs no knowledge of the marking pipelines and can be tested without a model.
 */
export async function reapplyScheme(input: {
  questionId: string;
  actorId: string;
  runSubmission: Runner;
}): Promise<ReapplyOutcome> {
  const responses = await prisma.questionResponse.findMany({
    where: { questionId: input.questionId },
    select: {
      id: true,
      status: true,
      gradingResult: true,
      submissionId: true,
      submission: { select: { confirmedAt: true, assessmentId: true } },
      reviewItems: { where: { reason: "SCHEME_NOT_APPROVED", status: { in: ["PENDING", "IN_REVIEW"] } }, select: { id: true } },
    },
  });

  const outcome: ReapplyOutcome = { rerun: 0, flagged: 0, left: 0 };
  const submissionsToRun = new Set<string>();

  for (const response of responses) {
    const action = reapplyAction({
      status: response.status,
      gradingResult: response.gradingResult,
      submissionConfirmed: response.submission.confirmedAt !== null,
      heldForScheme: response.reviewItems.length > 0,
    });

    if (action === "LEAVE") {
      outcome.left++;
      continue;
    }

    if (action === "FLAG_CHANGED") {
      outcome.flagged++;
      await createReviewItemIfNeeded({
        reason: "SCHEME_CHANGED",
        assessmentId: response.submission.assessmentId,
        submissionId: response.submissionId,
        questionId: input.questionId,
        questionResponseId: response.id,
        context: { kind: "SCHEME_CHANGED" },
      });
      continue;
    }

    // RERUN: reset the draft and record that this happened, in one step.
    const previous = parseGradingResult(response.gradingResult);
    await prisma.$transaction(async (tx) => {
      const reset = await tx.questionResponse.updateMany({
        // Conditional: if a teacher got there first in the meantime, nothing is overwritten.
        where: { id: response.id, status: response.status as never },
        data: {
          status: "PENDING",
          gradingResult: Prisma.DbNull,
          annotationResult: Prisma.DbNull,
          correctionResult: Prisma.DbNull,
          rubricVersionUsedId: null,
        },
      });
      if (reset.count === 0) return;
      if (response.reviewItems.length > 0) {
        await tx.reviewItem.updateMany({
          where: { id: { in: response.reviewItems.map((item) => item.id) } },
          data: { status: "RESOLVED" },
        });
      }
      await tx.markEvent.create({
        data: {
          kind: "SCHEME_REAPPLIED",
          submissionId: response.submissionId,
          questionResponseId: response.id,
          previousMarks: previous?.awardedMarks ?? null,
          actorId: input.actorId,
          reason: "The marking scheme changed, so this answer is being marked again.",
        },
      });
      outcome.rerun++;
      submissionsToRun.add(response.submissionId);
    });
  }

  for (const submissionId of submissionsToRun) {
    try {
      await input.runSubmission(submissionId);
    } finally {
      await recalculateSubmissionStatus(prisma, submissionId).catch(() => {});
    }
  }

  return outcome;
}
