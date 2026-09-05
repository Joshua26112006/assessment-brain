/**
 * Assessment Brain — shared foundational types.
 *
 * This file holds only cross-cutting types reused across the future pipeline
 * (question understanding, rubric generation, answer reading, correction,
 * novel-approach handling, annotation, grading). Stage-specific contracts are
 * intentionally deferred to when each stage is implemented.
 */

// ---------------------------------------------------------------------------
// ID aliases
// ---------------------------------------------------------------------------

export type ID = string;

export type SchoolId = ID;
export type TeacherId = ID;
export type StudentId = ID;
export type AssessmentId = ID;
export type QuestionId = ID;
export type RubricId = ID;
export type SubmissionId = ID;
export type AnswerSheetId = ID;
export type QuestionResponseId = ID;
export type RubricVersionId = ID;

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Coarse confidence bucket used wherever a pipeline stage produces a
 * machine-generated result that may need human review (e.g. OCR reads,
 * rubric matches, grading decisions).
 */
export type ConfidenceLevel = "low" | "medium" | "high";

/**
 * A numeric confidence score in the range [0, 1], paired with the coarse
 * bucket it falls into. Kept separate from ConfidenceLevel so callers can
 * choose to reason about either the raw score or the bucket.
 */
export interface ConfidenceScore {
  value: number; // 0 to 1
  level: ConfidenceLevel;
}

// ---------------------------------------------------------------------------
// Spatial / document geometry
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounding box in normalized coordinates (0 to 1, relative to
 * page width/height) so it stays valid across different scan resolutions.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber?: number;
}

// ---------------------------------------------------------------------------
// Extraction primitives
// ---------------------------------------------------------------------------

/**
 * A generic wrapper for any value that was extracted (from a scanned
 * document, an AI model, etc.) rather than directly authored by a user.
 * Used across question understanding, answer reading, and rubric generation
 * whenever a value needs traceability back to its source and confidence.
 */
export interface ExtractedValue<T> {
  value: T;
  confidence: ConfidenceScore;
  sourceLocation?: BoundingBox;
  needsReview?: boolean;
}

// ---------------------------------------------------------------------------
// Review / verification status
// ---------------------------------------------------------------------------

/**
 * Generic lifecycle status for anything that starts as an AI-generated
 * suggestion and may be reviewed/verified by a teacher (rubric entries,
 * annotations, grading decisions, etc.).
 */
export type ReviewStatus = "pending" | "approved" | "rejected" | "edited";

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp string. */
export type ISODateString = string;

export interface Timestamped {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
