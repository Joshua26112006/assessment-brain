import { prisma } from "@/lib/prisma";
import type { ReviewReason } from "@prisma/client";

interface CreateReviewItemInput {
  reason: ReviewReason;
  assessmentId: string;
  submissionId: string;
  /**
   * Both optional (Phase 3.4C): a handwritten-processing review signal may
   * be scoped to the whole submission — an invalid answer sheet, or content
   * that couldn't be mapped to any question — with no single Question or
   * QuestionResponse to attach to. Every existing caller (the Phase 2
   * pipeline) always supplies both; this only widens what's accepted, never
   * changes their behavior.
   */
  questionId?: string;
  questionResponseId?: string;
  context: Record<string, unknown>;
}

/**
 * Connects a genuine pipeline (or handwritten-processing) outcome to the
 * existing teacher review workflow by creating a ReviewItem — the model
 * already designed for exactly this ("uncertain novel approaches, ambiguous
 * answer extraction, uncertain correction, verification failures, ...", per
 * its own schema comment). Every link ReviewItem actually has available is
 * populated, which is what lets the existing ownership-scoped review-queue
 * query (src/app/teacher/review-queue/page.tsx) find it directly through
 * `assessment: { teacherId }` rather than only via a fallback join.
 *
 * Idempotent by construction: skips creating a duplicate if an equivalent
 * ReviewItem already exists. Per-question signals (questionResponseId
 * present) dedupe on {questionResponseId, reason} exactly as before;
 * submission-scoped signals (no questionResponseId — Phase 3.4C) dedupe on
 * {submissionId, reason} with no question/response link, so re-running
 * handwritten processing (retry after FAILED, a duplicate background-task
 * invocation) can never pile up duplicate review items either.
 *
 * Never throws — a failure here must not undo or mask an already-persisted
 * grading result or a persisted handwritten processing outcome; the caller
 * only needs to know it was attempted.
 */
export async function createReviewItemIfNeeded(input: CreateReviewItemInput): Promise<void> {
  try {
    const dedupeWhere = input.questionResponseId
      ? { questionResponseId: input.questionResponseId, reason: input.reason }
      : {
          submissionId: input.submissionId,
          questionResponseId: null,
          questionId: input.questionId ?? null,
          reason: input.reason,
        };

    const existing = await prisma.reviewItem.findFirst({
      where: dedupeWhere,
      select: { id: true },
    });
    if (existing) return;

    await prisma.reviewItem.create({
      data: {
        reason: input.reason,
        assessmentId: input.assessmentId,
        questionId: input.questionId ?? null,
        submissionId: input.submissionId,
        questionResponseId: input.questionResponseId ?? null,
        context: input.context as object,
      },
    });
  } catch (error) {
    console.error("Failed to create ReviewItem for pipeline outcome", error);
  }
}
