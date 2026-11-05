import { compareReadingToRubric } from "@/lib/structuredCorrection/comparisonEngine";
import { verifyComparisonResult } from "@/lib/structuredCorrection/verificationAgent";
import {
  buildUnverifiedExplanations,
  generateExplanations,
} from "@/lib/structuredCorrection/explanationGenerator";
import { scoreByCriteria } from "@/lib/structuredCorrection/criterionScoring";
import { reconcileFindingsWithMarks } from "@/lib/structuredCorrection/findings";
import { explanationAgreesWithFinding, withoutUnsupportedErrors } from "@/lib/structuredCorrection/findingChecks";
import type { QuestionScore } from "@/lib/structuredCorrection/scoring";
import type { Scheme } from "@/lib/scheme/criteria";
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
  /** The teacher-approved marking scheme: criteria, follow-through and no-working rules (decisions D6 to D10). */
  scheme: Scheme;
  partialCreditGuidance: string | null;
  structuredExpectation: StructuredExpectation | null;
  reading: ReconciledReading;
  /** Reasons from routing (an essay, a diagram, two attempts) that always send the answer to the teacher. */
  extraReasons?: string[];
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
  comparison: ComparisonResult,
): Promise<{ comparison: ComparisonResult; verification: VerificationResult | null; explanations: ErrorExplanation[]; mistakesWithheld: boolean }> {
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

  // A sentence about a finding may only use numbers the finding itself contains. One that brings in any other
  // number was not written from the finding, so that finding falls back to the plain deterministic wording.
  const errorById = new Map(comparison.errors.map((error) => [error.id, error]));
  const explanations =
    explained.status === "generated"
      ? explained.explanations.map((explanation) => {
          const error = errorById.get(explanation.errorId);
          if (!error || explanationAgreesWithFinding(explanation.explanation, error)) return explanation;
          return buildUnverifiedExplanations([error])[0] ?? explanation;
        })
      : buildUnverifiedExplanations(comparison.errors);

  return { comparison, verification, explanations, mistakesWithheld: false };
}

export async function correctStructuredQuestion(input: StructuredQuestionInput): Promise<StructuredQuestionCorrection> {
  // The comparison is deterministic and cheap, so it runs first: marking uses what it established
  // (the final answer, units) and does not have to guess it again.
  // A finding that quotes a value the student never wrote is dropped (decision D15), and so is any finding
  // that only existed as a consequence of it.
  const initialComparison = withoutUnsupportedErrors(
    compareReadingToRubric(input.reading, input.structuredExpectation),
    input.reading.transcription,
  );

  const [scoreOutcome, analysisOutcome] = await Promise.allSettled([
    scoreByCriteria({
      questionText: input.questionText,
      maximumMarks: input.maximumMarks,
      subject: input.subject,
      expectedAnswer: input.expectedAnswer,
      partialCreditGuidance: input.partialCreditGuidance,
      scheme: input.scheme,
      structuredExpectation: input.structuredExpectation,
      comparison: initialComparison,
      reading: input.reading,
      extraReasons: input.extraReasons,
    }),
    analyseErrors(input, initialComparison),
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

  const score = scoreOutcome.status === "fulfilled" ? scoreOutcome.value : null;

  // A mark and a mistake must not contradict each other: the marks decide what is shown.
  const explanations = score
    ? reconcileFindingsWithMarks({
        explanations: analysis.explanations,
        comparison: analysis.comparison,
        marking: score.marking,
        awardedMarks: score.awardedMarks,
        maximumMarks: score.maximumMarks,
      })
    : analysis.explanations;

  return {
    questionId: input.questionId,
    questionNumber: input.questionNumber,
    reading: input.reading,
    score,
    comparison: analysis.comparison,
    verification: analysis.verification,
    explanations,
    mistakesWithheld: analysis.mistakesWithheld,
  };
}
