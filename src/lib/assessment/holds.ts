import type { ReviewReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";

/**
 * Parks an answer for the teacher with a reason, instead of giving it a mark. Used where the system
 * must not mark an answer at all (a diagram, a language it does not mark) — never a silent zero.
 * Conditional on the answer not already being finished, so a teacher's decision is never overwritten.
 */

const TERMINAL_STATUSES = ["GRADED", "NEEDS_REVIEW", "FAILED"] as const;

export async function holdForTeacher(input: {
  responseId: string;
  assessmentId: string;
  submissionId: string;
  questionId: string;
  reason: ReviewReason;
  detail: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await prisma.questionResponse.updateMany({
    where: { id: input.responseId, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { status: "NEEDS_REVIEW" },
  });

  await createReviewItemIfNeeded({
    reason: input.reason,
    assessmentId: input.assessmentId,
    submissionId: input.submissionId,
    questionId: input.questionId,
    questionResponseId: input.responseId,
    context: { detail: input.detail, ...(input.context ?? {}) },
  });
}
