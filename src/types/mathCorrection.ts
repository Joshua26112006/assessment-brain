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
