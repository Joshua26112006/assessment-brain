/**
 * Assessment Brain — human review contracts (Phase 2.4).
 *
 * The teacher review workflow deliberately introduces no new tables: the
 * existing ReviewItem model already carries everything a resolution needs
 * (`status` for the lifecycle, `reviewerId` for who acted, `decision` for
 * what they decided). This file describes the shape written into that
 * untyped `decision` Json column.
 *
 * The decision record is an audit trail, not the authority: the mark a
 * student actually receives lives in QuestionResponse.gradingResult (see
 * TeacherReviewRecord in ./pipeline.ts). Both are written in the same
 * transaction, so they can't disagree.
 */

import type { ID, ISODateString, TeacherId } from "@/types/assessmentBrain";
import type { GradingEvidenceSource, GradingOutcome } from "@/types/pipeline";

export const REVIEW_DECISION_CONTRACT_VERSION = "1.0.0";

/**
 * What the teacher actually did.
 *
 * CONFIRMED  — accepted the pipeline's mark as final.
 * OVERRIDDEN — replaced the pipeline's mark with their own.
 * DISMISSED  — acknowledged the flag without changing the mark (only
 *              permitted when the response isn't waiting on a mark).
 */
export type ReviewDecisionAction = "CONFIRMED" | "OVERRIDDEN" | "DISMISSED";

export interface ReviewDecisionRecord {
  contractVersion: string;
  action: ReviewDecisionAction;
  decidedAt: ISODateString;
  reviewerId: TeacherId;
  questionResponseId: ID | null;
  /** The mark the response ended up with, or null for a DISMISSED flag that changed nothing. */
  awardedMarks: number | null;
  /** What the pipeline had concluded before this decision — null if it never produced a usable result. */
  previousAwardedMarks: number | null;
  previousOutcome: GradingOutcome | null;
  previousEvidenceSource: GradingEvidenceSource | null;
  /** Feedback written for the student during this review, if any. */
  feedbackNote: string | null;
}
