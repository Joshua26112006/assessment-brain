/**
 * Contracts for the Mathematics handwritten-correction flow.
 *
 * Deliberately separate from src/types/pipeline.ts: that describes the
 * deterministic-plus-AI evaluation of a typed QuestionResponse, which this
 * flow does not touch. Nothing here changes how a rubric's prose content
 * (src/types/rubricGeneration.ts) is produced or read — a StructuredExpectation
 * is an ADDITIONAL, machine-comparable view of the same rubric, generated
 * alongside it, never a replacement for it.
 */

/**
 * A value as the AI reported it (`raw`) plus what our own arithmetic evaluator
 * makes of it (`parsed`). `parsed` is never supplied by a model — see
 * src/lib/mathCorrection/numericExpression.ts for why. Null means "not cleanly
 * numeric", which the comparison stage treats as "cannot verify", never as a
 * mismatch.
 */
export interface ExtractedValue {
  raw: string;
  parsed: number | null;
}

/**
 * Surface-level classification used to sanity-check that the student and the
 * rubric are talking about the same kind of problem. Never a correctness
 * judgement, and "unknown" is a legitimate answer rather than a failure —
 * a forced guess here would be worse than no classification at all.
 */
export type MathProblemType =
  | "mean"
  | "median"
  | "mode"
  | "range"
  | "probability"
  | "algebra"
  | "coordinate_geometry"
  | "unknown";

/** Why a question has no single definite, checkable answer to compare against. */
export type UnsolvableReason =
  | "conceptual_question"
  | "proof_based"
  | "multiple_valid_answers"
  | "diagram_required"
  | "insufficient_information"
  | "other";

/**
 * The machine-comparable form of ONE of the rubric's solution approaches.
 * `label` mirrors the prose approach it was generated alongside, so a
 * comparison result can be reported against the method the teacher's rubric
 * actually names.
 */
export interface StructuredApproachExpectation {
  label: string;
  formulaName: string;
  formulaExpression: string;
  variables: Record<string, ExtractedValue>;
}

/**
 * Everything the deterministic comparison stage needs from a rubric.
 *
 * `correctAnswer` is single and top-level rather than per-approach: alternative
 * approaches are different routes to the same answer, so they must agree
 * numerically. A question whose approaches genuinely disagree is not a
 * comparable question at all — that is what `solvable: false` with
 * `multiple_valid_answers` is for.
 */
export interface StructuredExpectation {
  solvable: boolean;
  unsolvableReason?: UnsolvableReason;
  problemType: MathProblemType;
  correctAnswer: ExtractedValue | null;
  approaches: StructuredApproachExpectation[];
}

/**
 * How well two independent reads of the same handwriting agreed. Describes
 * confidence in the READING only — never whether the answer is correct.
 */
export type ReconcileConfidence = "high" | "medium" | "low";

/**
 * One question's answer as read from the student's pages, after reconciling
 * two independent passes (see src/lib/mathCorrection/structuredReading.ts).
 * Extraction only: nothing here is a judgement about correctness.
 */
export interface ReconciledMathReading {
  questionNumber: number;
  /** Verbatim transcription of the student's working, preserving their wording. */
  transcription: string;
  /** False when neither pass found any answer for this question — distinct from an answer that was read but is empty. */
  attempted: boolean;
  /** Agreement between the two independent reads of this question. */
  agreementConfidence: ReconcileConfidence;
  problemType: MathProblemType;
  /** The distinct logical steps the student wrote, in their own order. */
  steps: string[];
  /** Every named quantity the student explicitly wrote a value for. */
  variables: Record<string, ExtractedValue>;
  /** The student's final concluding value, or null if none was identifiable. */
  studentAnswer: ExtractedValue | null;
  /** The model's own confidence that the decomposition reflects the transcription. */
  structureConfidence: ReconcileConfidence;
}

// ---------------------------------------------------------------------------
// Deterministic comparison (src/lib/mathCorrection/comparisonEngine.ts)
// ---------------------------------------------------------------------------

/**
 * What kind of divergence was found. Only types the comparison engine can
 * genuinely detect from numbers are listed — there is deliberately no
 * "wrong formula" type, because two independently-written variable namings
 * differing does not reliably mean the student used the wrong method, and
 * guessing at that would produce confident nonsense.
 */
export type ComparisonErrorType =
  | "WRONG_SUBSTITUTION"
  | "ARITHMETIC_ERROR"
  | "MISSING_STEP"
  | "SIGN_ERROR"
  | "FINAL_ANSWER_ERROR";

export type ComparisonMethod = "numeric" | "sign_check" | "presence_check";

export interface ComparisonError {
  /** Stable within one ComparisonResult, so later stages can reference this exact error. */
  id: string;
  type: ComparisonErrorType;
  variable?: string;
  expected?: ExtractedValue;
  actual?: ExtractedValue;
  comparisonMethod: ComparisonMethod;
  tolerance?: number;
  /** Ids of errors that explain this one. Empty for a root error; populated for a downstream consequence. */
  dependsOn: string[];
}

export type ComparisonStatus =
  | "compared"
  /** The rubric declared this question has no single checkable answer. */
  | "skipped_unsolvable"
  /** The student did not attempt this question — a scoring outcome, not a mistake. */
  | "skipped_not_attempted"
  /** No structured expectation exists for this question (non-Maths, or generation produced none). */
  | "skipped_no_expectation";

export interface ComparisonResult {
  status: ComparisonStatus;
  /** Which of the rubric's approaches best matched the student's working. */
  matchedApproachLabel: string | null;
  /** Set only when the student's and rubric's problem classifications disagree — a pipeline-confidence signal, not a student error. */
  readingProblemType?: MathProblemType;
  expectationProblemType?: MathProblemType;
  errors: ComparisonError[];
  matchedVariableCount: number;
  totalExpectedVariableCount: number;
}

// ---------------------------------------------------------------------------
// Independent verification (src/lib/mathCorrection/verificationAgent.ts)
// ---------------------------------------------------------------------------

/**
 * `blocked` is distinct from `failed` on purpose: the claim itself was never
 * judged, because the finding it depends on did not survive verification.
 */
export type VerificationState = "verified" | "failed" | "blocked";

export interface VerificationEvidence {
  /** What the verifier derived on its own, from the question alone. */
  independentExpected: ExtractedValue;
  /** What the comparison claimed was correct, taken from the rubric. */
  claimedExpected: ExtractedValue;
  claimedActual?: ExtractedValue;
  match: boolean;
}

export interface ErrorVerification {
  errorId: string;
  state: VerificationState;
  confidence: ReconcileConfidence;
  evidence: VerificationEvidence;
  /** Which dependencies prevented this claim from being judged, when blocked. */
  blockedBy?: string[];
}

/** PASS only when every claim was independently confirmed — there is no partial pass. */
export type VerificationStatus = "PASS" | "FAIL";

export interface VerificationResult {
  status: VerificationStatus;
  perError: ErrorVerification[];
  failedErrorIds: string[];
  blockedErrorIds: string[];
}

// ---------------------------------------------------------------------------
// Student-facing explanation (src/lib/mathCorrection/explanationGenerator.ts)
// ---------------------------------------------------------------------------

export type ExplanationType =
  | "root_wrong_substitution"
  | "root_sign_error"
  | "root_arithmetic_error"
  | "root_missing_step"
  | "consequence_final_answer_error";

export interface ErrorExplanation {
  errorId: string;
  /** Derived deterministically from the error, never generated by the model. */
  explanationType: ExplanationType;
  explanation: string;
  /**
   * The student's own wrong value, verbatim. The annotation stage matches this
   * against the page's OCR to circle the exact spot, so it must never be
   * rephrased. Absent for a missing step — there is nothing written to circle.
   */
  wrongText?: string;
  correctVersion?: string;
}

/** `blocked` means verification did not pass, so nothing was written at all. */
export type ExplanationStatus = "generated" | "blocked";

export interface ExplanationResult {
  status: ExplanationStatus;
  explanations: ErrorExplanation[];
}

export const MATH_PROBLEM_TYPES: readonly MathProblemType[] = [
  "mean",
  "median",
  "mode",
  "range",
  "probability",
  "algebra",
  "coordinate_geometry",
  "unknown",
];

export const UNSOLVABLE_REASONS: readonly UnsolvableReason[] = [
  "conceptual_question",
  "proof_based",
  "multiple_valid_answers",
  "diagram_required",
  "insufficient_information",
  "other",
];
