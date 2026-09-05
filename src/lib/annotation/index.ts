import type {
  AnnotationEntry,
  AnnotationInput,
  AnnotationResult,
  CheckpointCorrectionResult,
  PipelineStage,
} from "@/types/pipeline";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * The deterministic "does this checkpoint's evidence look review-worthy"
 * rule. Extracted (Phase 2.2) so the orchestrator can compute a review
 * signal from resolved checkpoints *before* Annotation runs — Annotation
 * now runs after Grading (it explains the final verified outcome rather
 * than gating it), so its own `needsHumanReview` field is informational at
 * that point, not what actually decided the grading outcome.
 */
export function checkpointNeedsReview(checkpoint: CheckpointCorrectionResult): boolean {
  return checkpoint.outcome === "PARTIALLY_SATISFIED" || checkpoint.confidence.level === "low";
}

/**
 * Turns checkpoint evidence into short, structured per-checkpoint notes a
 * teacher can scan quickly. No new judgment is made here beyond the
 * checkpoints it's given (deterministic, or AI-verification-resolved) —
 * this stage formats and flags, it doesn't re-decide.
 */
export const annotateResponse: PipelineStage<AnnotationInput, AnnotationResult> = (input) => {
  const entries: AnnotationEntry[] = input.checkpointResults.map((checkpoint) => ({
    checkpointIndex: checkpoint.checkpointIndex,
    outcome: checkpoint.outcome,
    note:
      checkpoint.matchedTerms.length > 0
        ? `Matched: ${checkpoint.matchedTerms.join(", ")}`
        : "No matching evidence found",
    flaggedForReview: checkpointNeedsReview(checkpoint),
  }));

  return {
    ...stageResultBase("ANNOTATION"),
    entries,
    needsHumanReview: entries.some((entry) => entry.flaggedForReview),
  };
};
