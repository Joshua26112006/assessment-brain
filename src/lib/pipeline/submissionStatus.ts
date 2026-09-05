/**
 * Derives the student-facing processing state of a Submission purely from
 * its QuestionResponse rows — no new column. The existing SubmissionStatus
 * enum (SUBMITTED, PROCESSING, COMPLETED, NEEDS_REVIEW, FAILED) already has
 * one value for each of the five states a submitted assessment can be in,
 * so this maps QuestionResponse outcomes onto that existing enum rather
 * than inventing a parallel status representation.
 */

export type QuestionResponseStatusLike =
  | "PENDING"
  | "ANSWER_EXTRACTED"
  | "CORRECTING"
  | "CORRECTED"
  | "ANNOTATING"
  | "ANNOTATED"
  | "GRADING"
  | "GRADED"
  | "NEEDS_REVIEW"
  | "FAILED";

const IN_PROGRESS_STATUSES = new Set<QuestionResponseStatusLike>([
  "ANSWER_EXTRACTED",
  "CORRECTING",
  "CORRECTED",
  "ANNOTATING",
  "ANNOTATED",
  "GRADING",
]);

export interface QuestionResponseStatusSummary {
  total: number;
  awaitingProcessing: number;
  processing: number;
  graded: number;
  needsReview: number;
  failed: number;
}

export function summarizeQuestionResponseStatuses(
  statuses: QuestionResponseStatusLike[],
): QuestionResponseStatusSummary {
  const summary: QuestionResponseStatusSummary = {
    total: statuses.length,
    awaitingProcessing: 0,
    processing: 0,
    graded: 0,
    needsReview: 0,
    failed: 0,
  };

  for (const status of statuses) {
    if (status === "PENDING") summary.awaitingProcessing += 1;
    else if (IN_PROGRESS_STATUSES.has(status)) summary.processing += 1;
    else if (status === "GRADED") summary.graded += 1;
    else if (status === "NEEDS_REVIEW") summary.needsReview += 1;
    else if (status === "FAILED") summary.failed += 1;
  }

  return summary;
}

/**
 * The existing SubmissionStatus value a fully-attempted batch of responses
 * should end up at. Precedence (most to least urgent to surface):
 * FAILED > still-in-progress (PROCESSING) > NEEDS_REVIEW > COMPLETED.
 * A failure is surfaced even if other responses succeeded, since it's the
 * one outcome that genuinely needs attention rather than just patience.
 */
export function deriveAggregateSubmissionStatus(
  summary: QuestionResponseStatusSummary,
): "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED" {
  if (summary.failed > 0) return "FAILED";
  if (summary.awaitingProcessing > 0 || summary.processing > 0) return "PROCESSING";
  if (summary.needsReview > 0) return "NEEDS_REVIEW";
  return "COMPLETED";
}
