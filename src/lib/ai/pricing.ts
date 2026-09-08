import { JUDGE_MODEL, READ_MODEL, VERIFY_MODEL } from "@/lib/ai/models";

interface ModelPricing {
  usdPerMillionInputTokens: number;
  usdPerMillionOutputTokens: number;
}

/**
 * USD-per-million-token pricing, by OpenRouter model slug, for computing
 * AiCallLog.costUsd. Sourced from each model's own OpenRouter pricing page.
 *
 * VERIFY_MODEL's price is the standard rate shown on its OpenRouter page
 * ($2.00/M in, $12.00/M out) — a since-superseded promotional announcement
 * claimed a lower "exclusive discount" rate for this model, but that figure
 * also contradicted JUDGE_MODEL's confirmed price, so it wasn't trusted here.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  [READ_MODEL]: { usdPerMillionInputTokens: 0.75, usdPerMillionOutputTokens: 3.75 },
  [JUDGE_MODEL]: { usdPerMillionInputTokens: 0.2, usdPerMillionOutputTokens: 1.2 },
  [VERIFY_MODEL]: { usdPerMillionInputTokens: 2.0, usdPerMillionOutputTokens: 12.0 },
};

/**
 * Never throws and never guesses: an unpriced/unrecognized model slug
 * returns null rather than a fabricated cost, so a pricing-table gap can
 * never masquerade as a real (e.g. zero) dollar figure.
 */
export function computeCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  return (
    (promptTokens / 1_000_000) * pricing.usdPerMillionInputTokens +
    (completionTokens / 1_000_000) * pricing.usdPerMillionOutputTokens
  );
}
