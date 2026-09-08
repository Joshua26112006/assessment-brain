import type { StructuredExpectation } from "@/types/mathCorrection";

/**
 * Automatic AI rubric-generation contracts (Phase 4.1).
 *
 * Deliberately separate from src/types/pipeline.ts and
 * src/types/questionPaper.ts: this describes producing a NEW rubric for a
 * question that has no student answers yet, an entirely different concern
 * from evaluating a QuestionResponse against an existing rubric, or turning
 * an uploaded document into a draft of Questions. Nothing here is persisted
 * to QuestionResponse, and nothing in pipeline.ts is reused here.
 */

/**
 * One way to reach the expected answer. `isPrimary` marks the single most
 * standard/expected method; any other entries are genuine alternative
 * approaches that would also deserve full credit — never fabricated to pad
 * the list. `label` and `description` are read by the existing correction
 * pipeline's rubric-interpretation stage (src/lib/rubricInterpretation);
 * `steps` and `isPrimary` are additional fields it safely ignores.
 */
export interface RubricSolutionApproach {
  label: string;
  description: string;
  steps: string[];
  isPrimary: boolean;
}

/** One checkpoint a student's answer can earn marks against. */
export interface RubricMarkingCheckpoint {
  description: string;
  marks: number;
}

/** The full structured rubric produced by one generation attempt. */
export interface RubricDraft {
  expectedAnswer: string;
  solutionApproaches: RubricSolutionApproach[];
  markingCheckpoints: RubricMarkingCheckpoint[];
  partialCreditGuidance: string;
  /**
   * Machine-comparable view of the same rubric, generated alongside the prose
   * above for Mathematics questions only (see
   * src/lib/rubricGeneration/structuredExpectation.ts). Null for every other
   * subject, and whenever the model returned nothing usable — the prose rubric
   * is unaffected either way.
   */
  structuredExpectation: StructuredExpectation | null;
}

/** Raw, not-yet-validated shape of what the model actually returned. */
export interface RawRubricDraft {
  expectedAnswer?: unknown;
  solutionApproaches?: unknown;
  markingCheckpoints?: unknown;
  partialCreditGuidance?: unknown;
  structuredExpectation?: unknown;
}

/**
 * Phase 4.4 — pre-generation question-validation contracts. Deliberately
 * checked BEFORE any of the above rubric-content types are ever produced:
 * generateRubricWithAi only ever runs for a question this validator has
 * already judged VALID (see src/lib/rubricGeneration/index.ts), so nothing
 * here reuses or extends RubricDraft — a validation result never contains
 * rubric content, only a verdict.
 */
export type QuestionValidationIssueType =
  | "MISSING_INFORMATION"
  | "AMBIGUOUS_QUESTION"
  | "CONTRADICTORY_INFORMATION"
  | "INVALID_DATA"
  | "MISSING_REFERENCE"
  | "INCOMPLETE_QUESTION";

export type QuestionValidationResult =
  | { status: "VALID" }
  | {
      status: "REVIEW_REQUIRED";
      issueType: QuestionValidationIssueType;
      issueSummary: string;
      explanation: string;
    };

/** Raw, not-yet-validated shape of what the model actually returned. */
export interface RawQuestionValidationResult {
  status?: unknown;
  issueType?: unknown;
  issueSummary?: unknown;
  explanation?: unknown;
}
