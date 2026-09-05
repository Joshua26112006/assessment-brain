import type {
  CheckpointCorrectionResult,
  CheckpointOutcome,
  CheckpointVerification,
  CorrectionInput,
  CorrectionResult,
  InterpretedCheckpoint,
  PipelineStage,
} from "@/types/pipeline";
import type { ConfidenceScore } from "@/types/assessmentBrain";
import { findMatchingTerms, overlapRatio } from "@/lib/pipeline/text";
import { confidenceFromRatio, stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Deterministic checkpoint-by-checkpoint evaluation:
 *
 *   checkpoint -> evidence (matched terms) -> outcome -> marks awarded
 *   correctionTotal = sum(marks awarded)
 *
 * The placeholder evidence rule is keyword overlap between the checkpoint's
 * key terms and the student's normalized answer — intentionally simple
 * (this is explicitly NOT semantic matching), but the contract (per-
 * checkpoint outcome + evidence + marks, never a bare score) is the actual
 * point of this stage and will not change when a smarter matcher replaces
 * `evaluateCheckpoint` later.
 */
export const correctAnswer: PipelineStage<CorrectionInput, CorrectionResult> = (input) => {
  const answerText = input.normalizedAnswerText.toLowerCase();
  const checkpointResults = input.checkpoints.map((checkpoint) => evaluateCheckpoint(checkpoint, answerText));

  const warnings: string[] = [];
  if (input.checkpoints.length === 0) {
    warnings.push("No checkpoints were available to evaluate.");
  }

  return {
    ...stageResultBase("DETERMINISTIC_CORRECTION", warnings),
    rubricVersionId: input.rubricVersionId,
    checkpointResults,
    correctionTotal: round(checkpointResults.reduce((sum, c) => sum + c.marksAwarded, 0)),
    maximumPossibleFromCheckpoints: round(input.checkpoints.reduce((sum, c) => sum + c.maximumMarks, 0)),
  };
};

const SATISFIED_THRESHOLD = 0.6;

function evaluateCheckpoint(checkpoint: InterpretedCheckpoint, answerText: string): CheckpointCorrectionResult {
  const matchedTerms = findMatchingTerms(answerText, checkpoint.keyTerms);
  const ratio = overlapRatio(answerText, checkpoint.keyTerms);

  let outcome: CheckpointOutcome;
  let marksAwarded: number;
  let confidence: ConfidenceScore;

  if (checkpoint.keyTerms.length === 0) {
    // Nothing to match against — cannot confirm evidence either way. This
    // is the genuinely uncertain case (an underspecified checkpoint), so
    // it stays low-confidence and gets flagged for review downstream.
    outcome = "NOT_SATISFIED";
    marksAwarded = 0;
    confidence = { value: 0, level: "low" };
  } else if (ratio >= SATISFIED_THRESHOLD) {
    outcome = "SATISFIED";
    marksAwarded = checkpoint.maximumMarks;
    confidence = confidenceFromRatio(ratio);
  } else if (ratio > 0) {
    // A genuinely ambiguous partial match — worth a human look.
    outcome = "PARTIALLY_SATISFIED";
    marksAwarded = round(checkpoint.maximumMarks / 2);
    confidence = confidenceFromRatio(ratio);
  } else {
    // Zero overlap against a real, non-empty set of key terms is a clean,
    // confident negative — not the same kind of uncertainty as a partial
    // match. Using confidenceFromRatio(ratio) here would wrongly report
    // "low confidence" for the one case that's actually the most certain,
    // which was flooding annotation's review flag for ordinary wrong (or
    // blank) answers instead of just the genuinely ambiguous ones.
    outcome = "NOT_SATISFIED";
    marksAwarded = 0;
    confidence = confidenceFromRatio(1);
  }

  return {
    checkpointIndex: checkpoint.index,
    description: checkpoint.description,
    maximumMarks: checkpoint.maximumMarks,
    outcome,
    marksAwarded,
    matchedTerms,
    confidence,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The same deterministic marks-per-outcome rule evaluateCheckpoint uses, exposed for reuse by verification resolution. */
export function marksForOutcome(outcome: CheckpointOutcome, maximumMarks: number): number {
  if (outcome === "SATISFIED") return maximumMarks;
  if (outcome === "PARTIALLY_SATISFIED") return round(maximumMarks / 2);
  return 0;
}

const AI_TO_DETERMINISTIC_OUTCOME: Record<"satisfied" | "partially_satisfied" | "not_satisfied", CheckpointOutcome> = {
  satisfied: "SATISFIED",
  partially_satisfied: "PARTIALLY_SATISFIED",
  not_satisfied: "NOT_SATISFIED",
};

/**
 * Resolves final checkpoint outcomes by applying AI verification where it
 * gave a definite recommendation, and falling back to the original
 * deterministic outcome for any checkpoint verification didn't cover or
 * explicitly marked "needs_review" — the deterministic evidence is never
 * discarded, only potentially superseded by a verified one. Pure function;
 * does not call the network or touch the database.
 */
export function applyVerifiedOutcomes(
  checkpointResults: CheckpointCorrectionResult[],
  verifications: CheckpointVerification[] | null,
): { checkpoints: CheckpointCorrectionResult[]; total: number; anyNeedsReview: boolean } {
  if (!verifications || verifications.length === 0) {
    return {
      checkpoints: checkpointResults,
      total: round(checkpointResults.reduce((sum, c) => sum + c.marksAwarded, 0)),
      anyNeedsReview: false,
    };
  }

  const verificationByIndex = new Map(verifications.map((v) => [v.checkpointIndex, v]));
  let anyNeedsReview = false;

  const resolved = checkpointResults.map((checkpoint) => {
    const verification = verificationByIndex.get(checkpoint.checkpointIndex);
    if (!verification) return checkpoint;

    if (verification.recommendedOutcome === "needs_review") {
      anyNeedsReview = true;
      return checkpoint; // preserve deterministic evidence; don't fabricate a definite outcome
    }

    const resolvedOutcome = AI_TO_DETERMINISTIC_OUTCOME[verification.recommendedOutcome];
    return {
      ...checkpoint,
      outcome: resolvedOutcome,
      marksAwarded: marksForOutcome(resolvedOutcome, checkpoint.maximumMarks),
      confidence: verification.confidence,
    };
  });

  return {
    checkpoints: resolved,
    total: round(resolved.reduce((sum, c) => sum + c.marksAwarded, 0)),
    anyNeedsReview,
  };
}
