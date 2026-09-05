import { JUDGE_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type { AiNovelApproachResult, InterpretedSolutionApproach } from "@/types/pipeline";

interface RawAiNovelApproach {
  isPotentiallyNovel?: unknown;
  approachSummary?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
}

/**
 * AI opinion on whether the student's approach is conceptually distinct
 * from the rubric's known approaches (Phase 2.2 Step 12). Informational
 * only — the deterministic keyword-overlap gate in
 * src/lib/novelApproach/index.ts remains the sole authority on whether a
 * NovelApproachCandidate is actually created; a novel approach is never
 * automatically treated as correct.
 */
export async function detectNovelApproachWithAi(params: {
  questionText: string;
  normalizedAnswerText: string;
  knownApproaches: InterpretedSolutionApproach[];
}): Promise<AiNovelApproachResult> {
  const systemPrompt = [
    "You assess whether a student's exam answer represents a conceptually different approach from a list of known valid approaches.",
    "You do not decide whether the answer is correct — only whether its underlying approach looks distinct and plausible.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"isPotentiallyNovel": boolean, "approachSummary": "string", "reasoning": "string", "confidence": {"score": number between 0 and 1, "level": "low" | "medium" | "high"}}',
    "approachSummary: one sentence describing the approach the student actually used.",
    "reasoning: one concise sentence, not a chain-of-thought transcript.",
  ].join("\n");

  const approachList =
    params.knownApproaches.map((a) => `- ${a.label || a.description}: ${a.description}`).join("\n") || "(none recorded)";
  const userPrompt = [
    `Question:\n${params.questionText}`,
    `Known valid approaches:\n${approachList}`,
    `Student answer:\n${params.normalizedAnswerText}`,
  ].join("\n\n");

  const raw = await callStructuredAi<RawAiNovelApproach>({
    model: JUDGE_MODEL,
    systemPrompt,
    userPrompt,
  });

  return validate(raw);
}

function validate(raw: RawAiNovelApproach): AiNovelApproachResult {
  if (typeof raw.isPotentiallyNovel !== "boolean") {
    throw new Error("AI novel-approach response was missing isPotentiallyNovel.");
  }
  const confidence = parseConfidence(raw.confidence);
  if (!confidence) {
    throw new Error("AI novel-approach response had a missing or invalid confidence value.");
  }

  return {
    ...stageResultBase("NOVEL_APPROACH_AI"),
    isPotentiallyNovel: raw.isPotentiallyNovel,
    approachSummary: typeof raw.approachSummary === "string" ? raw.approachSummary : "",
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
    confidence,
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
