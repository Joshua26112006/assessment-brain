import { PIPELINE_CONTRACT_VERSION, type PipelineStageId } from "@/types/pipeline";

export function stageResultBase<TStage extends PipelineStageId>(stage: TStage, warnings: string[] = []) {
  return {
    stage,
    contractVersion: PIPELINE_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    warnings,
  };
}

/** Confidence bucket for a ratio in [0, 1], with fixed, documented thresholds. */
export function confidenceFromRatio(ratio: number): { value: number; level: "low" | "medium" | "high" } {
  const value = Math.max(0, Math.min(1, ratio));
  const level = value >= 0.6 ? "high" : value > 0 ? "medium" : "low";
  return { value, level };
}
