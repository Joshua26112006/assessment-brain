import { compareReadingToRubric } from "@/lib/structuredCorrection/comparisonEngine";
import { verifyComparisonResult } from "@/lib/structuredCorrection/verificationAgent";
import {
  buildUnverifiedExplanations,
  generateExplanations,
} from "@/lib/structuredCorrection/explanationGenerator";
import { scoreQuestion, type QuestionScore } from "@/lib/structuredCorrection/scoring";
import type {
  ComparisonResult,
  ErrorExplanation,
  ReconciledReading,
  StructuredExpectation,
  VerificationResult,
} from "@/types/structuredCorrection";
import type { RubricMarkingCheckpoint } from "@/types/rubricGeneration";

/**
 * Runs the structured correction stages for ONE question:
 *
 *   reading (already done for the whole submission, passed in)
 *     -> comparison against the rubric   (deterministic)
 *     -> independent verification        (only if errors were found)
 *     -> student-facing explanation      (wording depends on verification)
 *
 * with marking running alongside, because a mark and a mistake are separate
 * findings — see scoring.ts.
 *
 * Never throws. Every stage that can fail is contained, and the caller is told
 * plainly what could not be established rather than being handed a confident
 * result assembled from a broken run.
 */

export interface StructuredQuestionInput {
  questionId: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  subject: string;
  expectedAnswer: string | null;
  markingCheckpoints: RubricMarkingCheckpoint[];
  partialCreditGuidance: string | null;
  structuredExpectation: StructuredExpectation | null;
  reading: ReconciledReading;
}

export interface StructuredQuestionCorrection {
  questionId: string;
  questionNumber: number;
  /** The reading these findings were derived from, carried through for the record. */
  reading: ReconciledReading;
  /** Null when marking itself failed — the caller must flag this rather than record a zero. */
  score: QuestionScore | null;
  comparison: ComparisonResult;
  verification: VerificationResult | null;
  /**
   * Student-facing findings, one per comparison error. Confirmed findings name
   * the correct value; unconfirmed ones only point at the spot (see
   * buildUnverifiedExplanations), so nothing unverified is ever asserted.
   */
  explanations: ErrorExplanation[];
  /** True only when error analysis failed outright, so nothing could be looked for. */
  mistakesWithheld: boolean;
}

async function analyseErrors(
  input: StructuredQuestionInput,
): Promise<{ comparison: ComparisonResult; verification: VerificationResult | null; explanations: ErrorExplanation[]; mistakesWithheld: boolean }> {
  const comparison = compareReadingToRubric(input.reading, input.structuredExpectation);

  if (comparison.status !== "compared" || comparison.errors.length === 0) {
    return { comparison, verification: null, explanations: [], mistakesWithheld: false };
  }

  const question = {
    questionText: input.questionText,
    maximumMarks: input.maximumMarks,
    subject: input.subject,
  };

  const verification = await verifyComparisonResult(question, comparison);

  // Verification decides how confidently a finding is worded, not whether the
  // student is told about it at all. Withholding everything unless every claim
  // was confirmed was tried first and proved far too strict in practice: a
  // single unconfirmable claim silenced every mark on the question, so a
  // student lost marks with nothing on their page showing where. Deterministic
  // comparison against the rubric is real evidence on its own, so unconfirmed
  // findings are still shown — just worded so they assert nothing.
  if (verification.status !== "PASS") {
    return {
      comparison,
      verification,
      explanations: buildUnverifiedExplanations(comparison.errors),
      mistakesWithheld: false,
    };
  }

  const explained = await generateExplanations(question, comparison, verification);
  return {
    comparison,
    verification,
    explanations:
      explained.status === "generated"
        ? explained.explanations
        : buildUnverifiedExplanations(comparison.errors),
    mistakesWithheld: false,
  };
}

export async function correctStructuredQuestion(input: StructuredQuestionInput): Promise<StructuredQuestionCorrection> {
  const [scoreOutcome, analysisOutcome] = await Promise.allSettled([
    scoreQuestion({
      questionText: input.questionText,
      maximumMarks: input.maximumMarks,
      subject: input.subject,
      expectedAnswer: input.expectedAnswer,
      markingCheckpoints: input.markingCheckpoints,
      partialCreditGuidance: input.partialCreditGuidance,
      reading: input.reading,
    }),
    analyseErrors(input),
  ]);

  // A failed error analysis must not cost the student their mark, and a failed
  // marking call must not suppress findings that were properly confirmed —
  // which is why these are settled independently rather than awaited together.
  const analysis =
    analysisOutcome.status === "fulfilled"
      ? analysisOutcome.value
      : {
          comparison: {
            status: "skipped_no_expectation" as const,
            matchedApproachLabel: null,
            errors: [],
            matchedVariableCount: 0,
            totalExpectedVariableCount: 0,
          },
          verification: null,
          explanations: [],
          mistakesWithheld: true,
        };

  return {
    questionId: input.questionId,
    questionNumber: input.questionNumber,
    reading: input.reading,
    score: scoreOutcome.status === "fulfilled" ? scoreOutcome.value : null,
    comparison: analysis.comparison,
    verification: analysis.verification,
    explanations: analysis.explanations,
    mistakesWithheld: analysis.mistakesWithheld,
  };
}
