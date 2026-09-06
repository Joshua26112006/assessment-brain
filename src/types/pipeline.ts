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

import type { ConfidenceScore, ID, ISODateString, RubricVersionId, QuestionResponseId, TeacherId } from "@/types/assessmentBrain";

export const PIPELINE_CONTRACT_VERSION = "1.0.0";

export type PipelineStageId =
  | "ANSWER_READING"
  | "ANSWER_READING_AI"
  | "QUESTION_UNDERSTANDING"
  | "QUESTION_UNDERSTANDING_AI"
  | "RUBRIC_INTERPRETATION"
  | "RUBRIC_INTERPRETATION_AI"
  | "DETERMINISTIC_CORRECTION"
  | "INDEPENDENT_AI_EVALUATION"
  | "DETERMINISTIC_COMPARISON"
  | "AI_VERIFICATION"
  | "ANNOTATION"
  | "ANNOTATION_AI"
  | "GRADING"
  | "NOVEL_APPROACH_DETECTION"
  | "NOVEL_APPROACH_AI";

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

/**
 * AI-assisted enrichment layered on top of (never replacing) deterministic
 * Answer Reading. Purely observational: no marks, no grading input. The
 * deterministic `normalizedText` remains what every downstream matching
 * stage actually operates on — `cleanedText` here is informational context
 * only, per Phase 2.2's "AI enhances reasoning, never replaces deterministic
 * validation" principle.
 */
export type AiReadability = "readable" | "partially_readable" | "unreadable";

export interface AiAnswerReadingResult extends PipelineStageResultBase<"ANSWER_READING_AI"> {
  readability: AiReadability;
  cleanedText: string;
  observations: string[];
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

/**
 * AI-assisted semantic reading of the question, enriching (not replacing)
 * the deterministic key-term extraction above. Never produces a grade and
 * never substitutes for the teacher's rubric.
 */
export interface AiQuestionUnderstandingResult extends PipelineStageResultBase<"QUESTION_UNDERSTANDING_AI"> {
  questionIntent: string;
  keyConcepts: string[];
  expectedReasoning: string[];
  ambiguities: string[];
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

/**
 * AI-assisted clarification of what each checkpoint actually means and
 * what evidence would satisfy it. Interpretation only — never authority:
 * every `checkpointIndex` here must correspond to an index that genuinely
 * exists in the deterministic `checkpoints` above. The orchestrator drops
 * (does not trust) any AI-returned index that doesn't map back to a real,
 * teacher-authored checkpoint.
 */
export interface AiCheckpointInterpretation {
  checkpointIndex: number;
  meaning: string;
  expectedEvidence: string[];
}

export interface AiRubricInterpretationResult extends PipelineStageResultBase<"RUBRIC_INTERPRETATION_AI"> {
  checkpointInterpretations: AiCheckpointInterpretation[];
  rubricWarnings: string[];
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
  /**
   * Optional AI enrichment attached this run (Phase 2.2). All optional and
   * nullable so existing persisted rows (and any code that only knows the
   * Phase 2.1 shape) keep parsing correctly — see parseCorrectionResult.
   */
  aiContext?: {
    answerReading?: AiAnswerReadingResult | null;
    questionUnderstanding?: AiQuestionUnderstandingResult | null;
    rubricInterpretation?: AiRubricInterpretationResult | null;
  } | null;
  aiEvaluation?: IndependentAiEvaluationResult | null;
  comparison?: DeterministicComparisonResult | null;
  verification?: AiVerificationResult | null;
  /**
   * Checkpoint outcomes actually used for grading, after applying AI
   * verification where it ran (identical to `checkpointResults` when
   * verification didn't run or wasn't needed). Grading consumes this, not
   * the raw `checkpointResults`, once verification is available.
   */
  resolvedCheckpointResults?: CheckpointCorrectionResult[] | null;
  resolvedCorrectionTotal?: number | null;
}

// ---------------------------------------------------------------------------
// Independent AI Evaluation, Deterministic Comparison, AI Verification
// (Phase 2.2 — sit between Correction and Grading)
// ---------------------------------------------------------------------------

export type AiCheckpointOutcome = "satisfied" | "partially_satisfied" | "not_satisfied" | "uncertain";

/**
 * One checkpoint as independently assessed by an AI model with no
 * visibility into the deterministic result — evidence-based, never a bare
 * score. `checkpointIndex` must reference a real deterministic checkpoint;
 * the orchestrator discards any that don't.
 */
export interface AiCheckpointEvaluation {
  checkpointIndex: number;
  outcome: AiCheckpointOutcome;
  evidence: string[];
  reasoning: string;
}

export interface IndependentAiEvaluationResult extends PipelineStageResultBase<"INDEPENDENT_AI_EVALUATION"> {
  checkpointEvaluations: AiCheckpointEvaluation[];
  overallObservations: string[];
}

export type CheckpointAgreement = "agree" | "partial" | "disagree" | "ai_unavailable";

export interface CheckpointComparison {
  checkpointIndex: number;
  deterministicOutcome: CheckpointOutcome;
  aiOutcome: AiCheckpointOutcome | null;
  agreement: CheckpointAgreement;
}

/**
 * Pure deterministic comparison — no AI call of its own. Exists so
 * disagreement/uncertainty can be detected and routed to Verification
 * without ever letting the AI evaluation silently override deterministic
 * evidence.
 */
export interface DeterministicComparisonResult extends PipelineStageResultBase<"DETERMINISTIC_COMPARISON"> {
  checkpointComparisons: CheckpointComparison[];
  /** Count of "partial" + "disagree" entries — what actually warrants Verification. */
  disagreementCount: number;
}

export type VerifiedCheckpointOutcome = "satisfied" | "partially_satisfied" | "not_satisfied" | "needs_review";

export interface CheckpointVerification {
  checkpointIndex: number;
  recommendedOutcome: VerifiedCheckpointOutcome;
  reason: string;
  confidence: ConfidenceScore;
}

/**
 * Adjudicates disagreements between deterministic correction and the
 * independent AI evaluation. Constrained to the real rubric checkpoints —
 * never invents marks or criteria. A `needs_review` recommendation for a
 * checkpoint means "don't trust either evidence source confidently for
 * this one," not a specific outcome.
 */
export interface AiVerificationResult extends PipelineStageResultBase<"AI_VERIFICATION"> {
  checkpointVerifications: CheckpointVerification[];
  requiresReview: boolean;
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
  /** Optional AI-generated student-facing feedback (Phase 2.2), grounded in the resolved evidence. */
  aiAnnotation?: AiAnnotationResult | null;
  /**
   * Optional note a teacher wrote while resolving a review item (Phase 2.4).
   * Added alongside — never in place of — the machine-generated entries and
   * aiAnnotation above, so resolving a review never destroys AI evidence.
   */
  teacherFeedback?: TeacherFeedbackNote | null;
}

/** A teacher's own words for the student, attached during human review. */
export interface TeacherFeedbackNote {
  note: string;
  authoredAt: ISODateString;
  reviewerId: TeacherId;
  reviewItemId: ID;
}

/**
 * AI-generated feedback prose, built strictly from already-resolved
 * evidence (never asked to independently grade). `checkpointNotes` indices
 * are validated against the real rubric checkpoints before use.
 */
export interface AiCheckpointNote {
  checkpointIndex: number;
  feedback: string;
}

export interface AiAnnotationResult extends PipelineStageResultBase<"ANNOTATION_AI"> {
  summary: string;
  strengths: string[];
  improvements: string[];
  checkpointNotes: AiCheckpointNote[];
}

// ---------------------------------------------------------------------------
// 6. Grading
// ---------------------------------------------------------------------------

/**
 * Where the marks in a GradingResult ultimately came from.
 *
 * DETERMINISTIC / AI_VERIFIED are produced by the pipeline itself.
 * TEACHER_REVIEWED is only ever written by the human review workflow
 * (Phase 2.4) — a teacher confirming or overriding a pipeline result. It is
 * the highest authority: the pipeline never overwrites it, because a
 * teacher-reviewed response is already in a terminal status and so is
 * skipped by the orchestrator's idempotency guard.
 */
export type GradingEvidenceSource = "DETERMINISTIC" | "AI_VERIFIED" | "TEACHER_REVIEWED";

export type TeacherReviewAction = "CONFIRMED" | "OVERRIDDEN";

/**
 * Provenance for a grading result that a teacher has ruled on. The
 * pipeline's own conclusion is preserved in the `previous*` fields, so an
 * override records what the AI decided rather than erasing it — the
 * correction evidence itself (checkpoints, AI evaluation, comparison,
 * verification) is never touched at all and stays in `correctionResult`.
 */
export interface TeacherReviewRecord {
  action: TeacherReviewAction;
  reviewedAt: ISODateString;
  reviewerId: TeacherId;
  reviewItemId: ID;
  previousAwardedMarks: number | null;
  previousOutcome: GradingOutcome | null;
  previousEvidenceSource: GradingEvidenceSource | null;
}

export interface GradingInput {
  correctionTotal: number;
  maximumMarks: number;
  needsHumanReview: boolean;
  /** Whether correctionTotal reflects AI-verified checkpoint outcomes or purely deterministic ones. */
  evidenceSource: GradingEvidenceSource;
}

export type GradingOutcome = "FINAL" | "NEEDS_REVIEW";

export interface GradingResult extends PipelineStageResultBase<"GRADING"> {
  awardedMarks: number;
  maximumMarks: number;
  outcome: GradingOutcome;
  /**
   * Traceability only — grading's own clamping/outcome logic is identical
   * either way. Records whether the total it received came from AI-verified
   * evidence or pure deterministic correction; an AI model never decides
   * this value or the final mark itself.
   */
  evidenceSource: GradingEvidenceSource;
  /**
   * Present only once a teacher has ruled on this response through the
   * review workflow. When set, `awardedMarks`/`outcome` above are the
   * teacher's authoritative decision and `evidenceSource` is
   * "TEACHER_REVIEWED"; the superseded pipeline values live here.
   */
  teacherReview?: TeacherReviewRecord | null;
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
  /**
   * Optional AI opinion on conceptual novelty/plausibility (Phase 2.2) —
   * informational only. The deterministic isNovel/confidence above remain
   * the sole gate for whether a NovelApproachCandidate is actually created;
   * this is attached as supplementary context, never a second gate that
   * can override the deterministic one.
   */
  aiAssistance?: AiNovelApproachResult | null;
}

export interface AiNovelApproachResult extends PipelineStageResultBase<"NOVEL_APPROACH_AI"> {
  isPotentiallyNovel: boolean;
  approachSummary: string;
  reasoning: string;
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
