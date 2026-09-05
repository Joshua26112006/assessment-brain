/**
 * Assessment Brain — pipeline stage contracts.
 *
 * Adjacent to assessmentBrain.ts (kept separate so that file doesn't grow
 * unmanageable) and built on its shared foundational types (ID aliases,
 * ConfidenceScore, ISODateString).
 *
 * These contracts describe the data flow for evaluating one QuestionResponse:
 *
 *   QuestionResponse.studentAnswer
 *         v
 *   Answer Reading            -- reads studentAnswer, never persisted on its
 *         v                      own: cheap + deterministic to recompute from
 *         v                      the already-durable studentAnswer field.
 *   Question Understanding    -- reads Question.questionText, likewise
 *         v                      recomputed from an already-durable field.
 *         v
 *   Rubric Interpretation     -- reads the PINNED RubricVersion's JSON
 *         v                      content, likewise recomputed from an
 *         v                      already-durable (and immutable, once
 *         v                      pinned) field.
 *   Deterministic Correction  -- persisted to QuestionResponse.correctionResult
 *         v
 *   Annotation                -- persisted to QuestionResponse.annotationResult
 *         v
 *   Grading                   -- persisted to QuestionResponse.gradingResult
 *
 * Only Correction/Annotation/Grading get dedicated JSON columns on
 * QuestionResponse (matching the schema exactly: `correctionResult`,
 * `annotationResult`, `gradingResult`). Answer Reading, Question
 * Understanding, and Rubric Interpretation are pure derivations of data
 * that's already durably stored elsewhere (studentAnswer, Question,
 * RubricVersion), so persisting their output separately would just be a
 * redundant cache — recomputing them is cheap and always produces the same
 * result for the same (immutable, once pinned) inputs. This is a deliberate
 * reading of the existing schema, not an oversight — see the "no schema
 * change" note in pipeline.ts.
 *
 * Novel Approach Detection runs alongside Correction rather than in the
 * main chain; a positive result may produce a NovelApproachCandidate row
 * (that model already exists for exactly this purpose).
 */

import type { ConfidenceScore, ISODateString, RubricVersionId, QuestionResponseId } from "@/types/assessmentBrain";

export const PIPELINE_CONTRACT_VERSION = "1.0.0";

export type PipelineStageId =
  | "ANSWER_READING"
  | "QUESTION_UNDERSTANDING"
  | "RUBRIC_INTERPRETATION"
  | "DETERMINISTIC_CORRECTION"
  | "ANNOTATION"
  | "GRADING"
  | "NOVEL_APPROACH_DETECTION";

/**
 * Common shape every stage result shares. `warnings` is for genuinely
 * actionable notices (malformed input, missing data, clamped values) —
 * not a place to restate what the stage did.
 */
export interface PipelineStageResultBase<TStage extends PipelineStageId> {
  stage: TStage;
  contractVersion: string;
  generatedAt: ISODateString;
  warnings: string[];
}

/**
 * A pipeline stage is conceptually `execute(input) -> output`. Modeled as a
 * function type (not a class) so stage implementations stay plain,
 * independently-callable, pure functions per the "prefer pure functions"
 * requirement — nothing here requires touching the database.
 */
export type PipelineStage<TInput, TOutput> = (input: TInput) => TOutput;

// ---------------------------------------------------------------------------
// 1. Answer Reading
// ---------------------------------------------------------------------------

export interface AnswerReadingInput {
  /** QuestionResponse.studentAnswer exactly as stored — untyped JSON. */
  rawAnswer: unknown;
}

export type AnswerReadingStatus = "READ" | "BLANK" | "UNREADABLE";

export interface AnswerReadingResult extends PipelineStageResultBase<"ANSWER_READING"> {
  status: AnswerReadingStatus;
  normalizedText: string;
  characterCount: number;
  wordCount: number;
}

// ---------------------------------------------------------------------------
// 2. Question Understanding
// ---------------------------------------------------------------------------

export interface QuestionUnderstandingInput {
  questionText: string;
  maximumMarks: number;
}

export type ExpectedResponseLength = "SHORT" | "MEDIUM" | "EXTENDED";

export interface QuestionUnderstandingResult extends PipelineStageResultBase<"QUESTION_UNDERSTANDING"> {
  /** Deterministic bucket derived from maximumMarks — not a semantic read of the question. */
  expectedResponseLength: ExpectedResponseLength;
  /** Significant terms extracted from the question text (stopwords removed). */
  keyTerms: string[];
}

// ---------------------------------------------------------------------------
// 3. Rubric Interpretation
// ---------------------------------------------------------------------------

export interface RubricInterpretationInput {
  rubricVersionId: RubricVersionId;
  /** RubricVersion.solutionApproaches exactly as stored — untyped JSON. */
  solutionApproaches: unknown;
  /** RubricVersion.markingCheckpoints exactly as stored — untyped JSON. */
  markingCheckpoints: unknown;
}

/** Mirrors the real, existing shape teachers author (see teacher rubric editor). */
export interface InterpretedSolutionApproach {
  label: string;
  description: string;
  keyTerms: string[];
}

/** Mirrors the real, existing shape teachers author, plus a stable index. */
export interface InterpretedCheckpoint {
  index: number;
  description: string;
  maximumMarks: number;
  keyTerms: string[];
}

export interface RubricInterpretationResult extends PipelineStageResultBase<"RUBRIC_INTERPRETATION"> {
  rubricVersionId: RubricVersionId;
  approaches: InterpretedSolutionApproach[];
  checkpoints: InterpretedCheckpoint[];
  totalCheckpointMarks: number;
}

// ---------------------------------------------------------------------------
// 4. Deterministic Correction
// ---------------------------------------------------------------------------

export interface CorrectionInput {
  rubricVersionId: RubricVersionId;
  normalizedAnswerText: string;
  checkpoints: InterpretedCheckpoint[];
}

export type CheckpointOutcome = "SATISFIED" | "PARTIALLY_SATISFIED" | "NOT_SATISFIED";

/** Evidence + outcome for one checkpoint — never just a bare number. */
export interface CheckpointCorrectionResult {
  checkpointIndex: number;
  description: string;
  maximumMarks: number;
  outcome: CheckpointOutcome;
  marksAwarded: number;
  /** The specific checkpoint key terms actually found in the answer. */
  matchedTerms: string[];
  confidence: ConfidenceScore;
}

export interface CorrectionResult extends PipelineStageResultBase<"DETERMINISTIC_CORRECTION"> {
  rubricVersionId: RubricVersionId;
  checkpointResults: CheckpointCorrectionResult[];
  /** sum(checkpoint marks awarded) — the deterministic total this stage guarantees. */
  correctionTotal: number;
  maximumPossibleFromCheckpoints: number;
}

// ---------------------------------------------------------------------------
// 5. Annotation
// ---------------------------------------------------------------------------

export interface AnnotationInput {
  checkpointResults: CheckpointCorrectionResult[];
}

export interface AnnotationEntry {
  checkpointIndex: number;
  outcome: CheckpointOutcome;
  /** Short structured label (e.g. "Matched: photosynthesis, chlorophyll"), not prose. */
  note: string;
  flaggedForReview: boolean;
}

export interface AnnotationResult extends PipelineStageResultBase<"ANNOTATION"> {
  entries: AnnotationEntry[];
  needsHumanReview: boolean;
}

// ---------------------------------------------------------------------------
// 6. Grading
// ---------------------------------------------------------------------------

export interface GradingInput {
  correctionTotal: number;
  maximumMarks: number;
  needsHumanReview: boolean;
}

export type GradingOutcome = "FINAL" | "NEEDS_REVIEW";

export interface GradingResult extends PipelineStageResultBase<"GRADING"> {
  awardedMarks: number;
  maximumMarks: number;
  outcome: GradingOutcome;
}

// ---------------------------------------------------------------------------
// Novel Approach Detection (runs alongside Correction, not in the main chain)
// ---------------------------------------------------------------------------

export interface NovelApproachDetectionInput {
  normalizedAnswerText: string;
  knownApproaches: InterpretedSolutionApproach[];
}

export interface NovelApproachDetectionResult extends PipelineStageResultBase<"NOVEL_APPROACH_DETECTION"> {
  isNovel: boolean;
  /** The closest known approach, if any comparison was possible. */
  bestMatchApproachLabel: string | null;
  bestMatchOverlapRatio: number;
  confidence: ConfidenceScore;
}

// ---------------------------------------------------------------------------
// Orchestrator-level result
// ---------------------------------------------------------------------------

export type StageExecutionOutcome = "COMPLETED" | "SKIPPED" | "FAILED";

/**
 * Per-stage execution record for observability. The schema has no
 * dedicated pipeline-run table, so this — not a database write per
 * intermediate stage — is where fine-grained execution state lives for now
 * (only the final terminal QuestionResponseStatus is persisted).
 */
export interface StageExecutionRecord {
  stage: PipelineStageId;
  outcome: StageExecutionOutcome;
  startedAt: ISODateString;
  finishedAt: ISODateString;
  warnings: string[];
}

export type PipelineRunStatus =
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED"
  | "SKIPPED_ALREADY_GRADED"
  | "BLOCKED_NOT_SUBMITTED"
  | "BLOCKED_NO_ACTIVE_RUBRIC";

export interface PipelineRunResult {
  questionResponseId: QuestionResponseId;
  status: PipelineRunStatus;
  rubricVersionId: RubricVersionId | null;
  stageExecutions: StageExecutionRecord[];
  correction: CorrectionResult | null;
  annotation: AnnotationResult | null;
  grading: GradingResult | null;
  novelApproach: NovelApproachDetectionResult | null;
  novelApproachCandidateCreated: boolean;
  error: string | null;
}
