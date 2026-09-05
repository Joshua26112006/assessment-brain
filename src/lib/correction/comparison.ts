import { stageResultBase } from "@/lib/pipeline/stageResult";
import type {
  AiCheckpointEvaluation,
  CheckpointAgreement,
  CheckpointComparison,
  CheckpointCorrectionResult,
  CheckpointOutcome,
  DeterministicComparisonResult,
} from "@/types/pipeline";

/** Ordinal scale so "how far apart" two outcomes are can be measured, not just equality. */
const DETERMINISTIC_ORDINAL: Record<CheckpointOutcome, number> = {
  NOT_SATISFIED: 0,
  PARTIALLY_SATISFIED: 1,
  SATISFIED: 2,
};
const AI_ORDINAL: Record<Exclude<AiCheckpointEvaluation["outcome"], "uncertain">, number> = {
  not_satisfied: 0,
  partially_satisfied: 1,
  satisfied: 2,
};

/**
 * Purely deterministic comparison between correction's evidence and the
 * independent AI evaluation's evidence — no AI call of its own. This is
 * what decides whether Verification is even worth running (Phase 2.2 Step
 * 8): if everything already agrees, there's nothing to adjudicate.
 */
export function compareCheckpoints(
  deterministicResults: CheckpointCorrectionResult[],
  aiEvaluations: AiCheckpointEvaluation[] | null,
): DeterministicComparisonResult {
  const aiByIndex = new Map((aiEvaluations ?? []).map((e) => [e.checkpointIndex, e]));

  const checkpointComparisons: CheckpointComparison[] = deterministicResults.map((deterministic) => {
    const aiEvaluation = aiByIndex.get(deterministic.checkpointIndex);
    return {
      checkpointIndex: deterministic.checkpointIndex,
      deterministicOutcome: deterministic.outcome,
      aiOutcome: aiEvaluation?.outcome ?? null,
      agreement: computeAgreement(deterministic.outcome, aiEvaluation?.outcome ?? null),
    };
  });

  const disagreementCount = checkpointComparisons.filter(
    (c) => c.agreement === "partial" || c.agreement === "disagree",
  ).length;

  return {
    ...stageResultBase("DETERMINISTIC_COMPARISON"),
    checkpointComparisons,
    disagreementCount,
  };
}

function computeAgreement(
  deterministicOutcome: CheckpointOutcome,
  aiOutcome: AiCheckpointEvaluation["outcome"] | null,
): CheckpointAgreement {
  if (aiOutcome === null) return "ai_unavailable";
  if (aiOutcome === "uncertain") return "partial";

  const distance = Math.abs(DETERMINISTIC_ORDINAL[deterministicOutcome] - AI_ORDINAL[aiOutcome]);
  if (distance === 0) return "agree";
  if (distance === 1) return "partial";
  return "disagree";
}
