import { prisma } from "@/lib/prisma";
import type { ReviewReason } from "@prisma/client";

interface CreateReviewItemInput {
  reason: ReviewReason;
  assessmentId: string;
  questionId: string;
  submissionId: string;
  questionResponseId: string;
  context: Record<string, unknown>;
}

/**
 * Connects a genuine pipeline outcome to the existing teacher review
 * workflow by creating a ReviewItem — the model already designed for
 * exactly this ("uncertain novel approaches, ambiguous answer extraction,
 * uncertain correction, verification failures, ...", per its own schema
 * comment). All four of ReviewItem's optional links are populated when
 * available, which is what lets the existing ownership-scoped review-queue
 * query (src/app/teacher/review-queue/page.tsx) find it directly through
 * `assessment: { teacherId }` rather than only via a fallback join.
 *
 * Idempotent by construction: skips creating a duplicate if a ReviewItem
 * for this exact response + reason already exists, so re-processing an
 * already-terminal response (which the pipeline's own idempotency guard
 * should normally prevent anyway) can never pile up duplicate review items.
 *
 * Never throws — a failure here must not undo or mask an already-persisted
 * grading result; the caller only needs to know it was attempted.
 */
export async function createReviewItemIfNeeded(input: CreateReviewItemInput): Promise<void> {
  try {
    const existing = await prisma.reviewItem.findFirst({
      where: { questionResponseId: input.questionResponseId, reason: input.reason },
      select: { id: true },
    });
    if (existing) return;

    await prisma.reviewItem.create({
      data: {
        reason: input.reason,
        assessmentId: input.assessmentId,
        questionId: input.questionId,
        submissionId: input.submissionId,
        questionResponseId: input.questionResponseId,
        context: input.context as object,
      },
    });
  } catch (error) {
    console.error("Failed to create ReviewItem for pipeline outcome", error);
  }
}
