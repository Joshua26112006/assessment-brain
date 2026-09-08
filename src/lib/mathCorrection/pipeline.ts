import { compareReadingToRubric } from "@/lib/mathCorrection/comparisonEngine";
import { verifyComparisonResult } from "@/lib/mathCorrection/verificationAgent";
import { generateExplanations } from "@/lib/mathCorrection/explanationGenerator";
import { scoreQuestion, type QuestionScore } from "@/lib/mathCorrection/scoring";
import type {
  ComparisonResult,
  ErrorExplanation,
  ReconciledMathReading,
  StructuredExpectation,
  VerificationResult,
} from "@/types/mathCorrection";
import type { RubricMarkingCheckpoint } from "@/types/rubricGeneration";

/**
 * Runs the Mathematics correction stages for ONE question:
 *
 *   reading (already done for the whole submission, passed in)
 *     -> comparison against the rubric   (deterministic)
 *     -> independent verification        (only if errors were found)
 *     -> student-facing explanation      (only if verification passed)
 *
 * with marking running alongside, because a mark and a mistake are separate
 * findings — see scoring.ts.
 *
 * Never throws. Every stage that can fail is contained, and the caller is told
 * plainly what could not be established rather than being handed a confident
 * result assembled from a broken run.
 */

export interface MathQuestionInput {
  questionId: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  subject: string;
  expectedAnswer: string | null;
  markingCheckpoints: RubricMarkingCheckpoint[];
  partialCreditGuidance: string | null;
  structuredExpectation: StructuredExpectation | null;
  reading: ReconciledMathReading;
}

export interface MathQuestionCorrection {
  questionId: string;
  questionNumber: number;
  /** Null when marking itself failed — the caller must flag this rather than record a zero. */
  score: QuestionScore | null;
  comparison: ComparisonResult;
  verification: VerificationResult | null;
  /** Confirmed, student-facing findings. Empty whenever nothing survived verification. */
  explanations: ErrorExplanation[];
  /**
   * True when the comparison did find errors but they could not be
   * independently confirmed, so none are being shown. The findings are
   * withheld rather than shown with a caveat: an unconfirmed claim marked on
   * a student's own page reads to them as a fact about their work.
   */
  mistakesWithheld: boolean;
}

async function analyseErrors(
  input: MathQuestionInput,
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
  if (verification.status !== "PASS") {
    return { comparison, verification, explanations: [], mistakesWithheld: true };
  }

  const explained = await generateExplanations(question, comparison, verification);
  return {
    comparison,
    verification,
    explanations: explained.explanations,
    mistakesWithheld: explained.status !== "generated",
  };
}

export async function correctMathQuestion(input: MathQuestionInput): Promise<MathQuestionCorrection> {
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
    score: scoreOutcome.status === "fulfilled" ? scoreOutcome.value : null,
    comparison: analysis.comparison,
    verification: analysis.verification,
    explanations: analysis.explanations,
    mistakesWithheld: analysis.mistakesWithheld,
  };
}
