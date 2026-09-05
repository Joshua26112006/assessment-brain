import type { AnnotationEntry, AnnotationInput, AnnotationResult, PipelineStage } from "@/types/pipeline";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Turns correction evidence into short, structured per-checkpoint notes a
 * teacher can scan quickly, and decides (deterministically) whether the
 * response as a whole warrants human review. No new judgment is made here
 * beyond correction's own outcomes/confidence — this stage formats and
 * flags, it doesn't re-decide.
 */
export const annotateResponse: PipelineStage<AnnotationInput, AnnotationResult> = (input) => {
  const entries: AnnotationEntry[] = input.checkpointResults.map((checkpoint) => ({
    checkpointIndex: checkpoint.checkpointIndex,
    outcome: checkpoint.outcome,
    note:
      checkpoint.matchedTerms.length > 0
        ? `Matched: ${checkpoint.matchedTerms.join(", ")}`
        : "No matching evidence found",
    flaggedForReview: checkpoint.outcome === "PARTIALLY_SATISFIED" || checkpoint.confidence.level === "low",
  }));

  return {
    ...stageResultBase("ANNOTATION"),
    entries,
    needsHumanReview: entries.some((entry) => entry.flaggedForReview),
  };
};
