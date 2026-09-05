import type {
  InterpretedSolutionApproach,
  NovelApproachDetectionInput,
  NovelApproachDetectionResult,
  PipelineStage,
} from "@/types/pipeline";
import { overlapRatio } from "@/lib/pipeline/text";
import { confidenceFromRatio, stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Deterministic placeholder answering "does this answer look like none of
 * the rubric's known approaches?" — via best keyword-overlap ratio against
 * each known approach, same heuristic family as correction. This is NOT
 * semantic novelty detection; it only flags answers that are substantive
 * (non-blank) yet share almost no vocabulary with anything the rubric
 * anticipated. A future AI stage replaces the matching, not this contract.
 *
 * This function does not persist anything — the orchestrator decides
 * whether a NovelApproachCandidate row is warranted.
 */
export const detectNovelApproach: PipelineStage<NovelApproachDetectionInput, NovelApproachDetectionResult> = (
  input,
) => {
  const answerText = input.normalizedAnswerText.toLowerCase();
  const isBlank = answerText.trim().length === 0;

  const best = findBestMatch(answerText, input.knownApproaches);

  const NOVEL_THRESHOLD = 0.2;
  const isNovel = !isBlank && input.knownApproaches.length > 0 && best.ratio < NOVEL_THRESHOLD;

  const warnings: string[] = [];
  if (input.knownApproaches.length === 0) {
    warnings.push("No known solution approaches to compare against.");
  }

  return {
    ...stageResultBase("NOVEL_APPROACH_DETECTION", warnings),
    isNovel,
    bestMatchApproachLabel: best.label,
    bestMatchOverlapRatio: best.ratio,
    confidence: confidenceFromRatio(1 - best.ratio),
  };
};

function findBestMatch(
  answerText: string,
  approaches: InterpretedSolutionApproach[],
): { label: string | null; ratio: number } {
  let best: { label: string | null; ratio: number } = { label: null, ratio: 0 };
  for (const approach of approaches) {
    const ratio = overlapRatio(answerText, approach.keyTerms);
    if (ratio > best.ratio) {
      best = { label: approach.label || approach.description, ratio };
    }
  }
  return best;
}
