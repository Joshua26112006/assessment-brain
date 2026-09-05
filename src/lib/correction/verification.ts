import { VERIFY_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type {
  AiVerificationResult,
  CheckpointComparison,
  CheckpointCorrectionResult,
  CheckpointVerification,
  VerifiedCheckpointOutcome,
} from "@/types/pipeline";

const VALID_OUTCOMES = new Set<string>(["satisfied", "partially_satisfied", "not_satisfied", "needs_review"]);

interface RawCheckpointVerification {
  checkpointIndex?: unknown;
  recommendedOutcome?: unknown;
  reason?: unknown;
  confidence?: unknown;
}

interface RawVerification {
  checkpointVerifications?: unknown;
  requiresReview?: unknown;
}

/**
 * Adjudicates disagreement/uncertainty between deterministic correction and
 * the independent AI evaluation (Phase 2.2 Step 9). Only ever called when
 * comparison found something worth adjudicating — see pipeline.ts's cost
 * gating. Must not blindly trust the independent evaluation just because
 * it's the more recent AI opinion; it's given both sides' evidence and
 * asked to decide, or to say the checkpoint needs a human.
 */
export async function verifyDisagreements(params: {
  questionText: string;
  normalizedAnswerText: string;
  deterministicResults: CheckpointCorrectionResult[];
  comparisons: CheckpointComparison[];
}): Promise<AiVerificationResult> {
  const validIndices = new Set(params.deterministicResults.map((c) => c.checkpointIndex));
  const deterministicByIndex = new Map(params.deterministicResults.map((c) => [c.checkpointIndex, c]));

  const disputedComparisons = params.comparisons.filter(
    (c) => c.agreement === "partial" || c.agreement === "disagree",
  );

  const disputedDescriptions = disputedComparisons
    .map((c) => {
      const det = deterministicByIndex.get(c.checkpointIndex);
      return [
        `- checkpoint ${c.checkpointIndex} ("${det?.description ?? "unknown"}", ${det?.maximumMarks ?? "?"} marks):`,
        `  deterministic keyword-matching says: ${c.deterministicOutcome} (matched terms: ${det?.matchedTerms.join(", ") || "none"})`,
        `  independent AI evaluation says: ${c.aiOutcome ?? "unavailable"}`,
      ].join("\n");
    })
    .join("\n");

  const systemPrompt = [
    "You adjudicate disagreements between two independent evaluations of a student's exam answer against a fixed rubric checkpoint.",
    "You must decide ONLY for the disputed checkpoints listed below — never invent new checkpoints or change any checkpoint's marks.",
    "Do not automatically favor either the keyword-matching result or the AI evaluation — weigh the actual evidence.",
    "If the evidence genuinely does not clearly support one outcome, recommend \"needs_review\" rather than guessing.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"checkpointVerifications": [{"checkpointIndex": number, "recommendedOutcome": "satisfied" | "partially_satisfied" | "not_satisfied" | "needs_review", "reason": "string", "confidence": {"score": number between 0 and 1, "level": "low" | "medium" | "high"}}], "requiresReview": boolean}',
    "reason: one concise sentence grounded in the actual answer text, not a chain-of-thought transcript.",
    "requiresReview: true if any checkpoint is \"needs_review\" or you are not confident in your recommendations overall.",
  ].join("\n");

  const userPrompt = [
    `Question:\n${params.questionText}`,
    `Student answer:\n${params.normalizedAnswerText}`,
    `Disputed checkpoints:\n${disputedDescriptions}`,
  ].join("\n\n");

  const raw = await callStructuredAi<RawVerification>({
    model: VERIFY_MODEL,
    systemPrompt,
    userPrompt,
  });

  return validate(raw, validIndices);
}

function validate(raw: RawVerification, validIndices: Set<number>): AiVerificationResult {
  const rawVerifications = Array.isArray(raw.checkpointVerifications) ? raw.checkpointVerifications : [];

  const checkpointVerifications: CheckpointVerification[] = rawVerifications
    .filter((item): item is RawCheckpointVerification => typeof item === "object" && item !== null)
    .map((item): CheckpointVerification | null => {
      const checkpointIndex = typeof item.checkpointIndex === "number" ? item.checkpointIndex : -1;
      const recommendedOutcome =
        typeof item.recommendedOutcome === "string" && VALID_OUTCOMES.has(item.recommendedOutcome)
          ? (item.recommendedOutcome as VerifiedCheckpointOutcome)
          : null;
      const confidence = parseConfidence(item.confidence);

      if (!validIndices.has(checkpointIndex) || recommendedOutcome === null || !confidence) {
        return null;
      }

      return {
        checkpointIndex,
        recommendedOutcome,
        reason: typeof item.reason === "string" ? item.reason : "",
        confidence,
      };
    })
    .filter((v): v is CheckpointVerification => v !== null);

  const requiresReview =
    typeof raw.requiresReview === "boolean"
      ? raw.requiresReview
      : checkpointVerifications.some((v) => v.recommendedOutcome === "needs_review");

  return {
    ...stageResultBase("AI_VERIFICATION"),
    checkpointVerifications,
    requiresReview,
  };
}

function parseConfidence(value: unknown): { value: number; level: "low" | "medium" | "high" } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const score = typeof record.score === "number" ? record.score : null;
  const level = record.level;
  if (score === null || (level !== "low" && level !== "medium" && level !== "high")) {
    return null;
  }
  return { value: Math.max(0, Math.min(1, score)), level };
}
