import { prisma } from "@/lib/prisma";
import { computeCostUsd } from "@/lib/ai/pricing";

/**
 * Persists one AiCallLog row for a completed OpenRouter call. Never throws —
 * a logging failure must never surface as (or mask) an AI call failure, the
 * same discipline as createReviewItemIfNeeded
 * (src/lib/assessment/pipelineReviewItems.ts).
 *
 * Silently skips the write (rather than logging a zero/null cost) when
 * either token count is missing — some providers omit `usage` on certain
 * response shapes — or the model has no pricing entry, since a missing-cost
 * row is worse for observability than no row at all.
 */
export interface AiCallUsage {
  model: string;
  stage: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

const usageListeners = new Set<(usage: AiCallUsage) => void>();

/**
 * Lets a caller (the evaluation scripts) total what a run of AI calls cost without reading the database. The
 * listener sees each completed call with its computed cost; returns a function that stops listening. Nothing in
 * the product uses this; a listener that throws is ignored.
 */
export function onAiCallUsage(listener: (usage: AiCallUsage) => void): () => void {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

export async function recordAiCallUsage(params: {
  model: string;
  stage: string;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    if (params.promptTokens === undefined || params.completionTokens === undefined) return;

    const costUsd = computeCostUsd(params.model, params.promptTokens, params.completionTokens);
    if (costUsd === null) return;

    for (const listener of usageListeners) {
      try {
        listener({ model: params.model, stage: params.stage, promptTokens: params.promptTokens, completionTokens: params.completionTokens, costUsd });
      } catch {
        // a listener must never affect the call it is watching
      }
    }

    await prisma.aiCallLog.create({
      data: {
        model: params.model,
        stage: params.stage,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        costUsd,
        context: (params.context as object | undefined) ?? undefined,
      },
    });
  } catch (error) {
    console.error("Failed to record AiCallLog for a completed AI call", error);
  }
}
