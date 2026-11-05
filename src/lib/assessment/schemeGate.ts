import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { isSchemeApproved } from "@/lib/scheme/criteria";

/**
 * Nothing is marked against a scheme no teacher has approved (decision D8 of
 * 06-correction-hardening-plan.md). Both marking routes call this at the moment
 * they would otherwise start, so the rule cannot be bypassed by taking a
 * different route through the pipeline.
 *
 * A held answer is NOT given a mark. It is parked for the teacher with a clear
 * reason (never a silent zero, principle 2) and is picked up again when the
 * scheme is approved (see schemeReapply.ts).
 */

const TERMINAL_STATUSES = ["GRADED", "NEEDS_REVIEW", "FAILED"] as const;

/** Whether a rubric version may be used to mark. A missing version may not. */
export function mayMarkAgainst(version: { approvedAt?: Date | string | null } | null | undefined): boolean {
  return isSchemeApproved(version);
}

export async function holdForUnapprovedScheme(input: {
  responseId: string;
  assessmentId: string;
  submissionId: string;
  questionId: string;
}): Promise<void> {
  // Conditional on the answer not already being finished: a teacher's decision is never overwritten.
  await prisma.questionResponse.updateMany({
    where: { id: input.responseId, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { status: "NEEDS_REVIEW" },
  });

  await createReviewItemIfNeeded({
    reason: "SCHEME_NOT_APPROVED",
    assessmentId: input.assessmentId,
    submissionId: input.submissionId,
    questionId: input.questionId,
    questionResponseId: input.responseId,
    context: { kind: "SCHEME_NOT_APPROVED" },
  });
}
