import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type { AiAnswerReadingResult, AiReadability } from "@/types/pipeline";

const VALID_READABILITY = new Set<string>(["readable", "partially_readable", "unreadable"]);

interface RawAiAnswerReading {
  readability?: unknown;
  cleanedText?: unknown;
  observations?: unknown;
}

/**
 * AI-assisted enrichment of Answer Reading. Never called for blank answers
 * — the deterministic stage already handles those definitively and there's
 * nothing to enrich (see pipeline.ts's cost-control gating). Never assigns
 * marks; purely observational per Phase 2.2 Step 4.
 */
export async function readAnswerWithAi(params: {
  questionText: string;
  normalizedAnswerText: string;
}): Promise<AiAnswerReadingResult> {
  const systemPrompt = [
    "You review a student's typed exam answer for basic readability only.",
    "You do not grade, score, or judge correctness — that is done elsewhere.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"readability": "readable" | "partially_readable" | "unreadable", "cleanedText": "string", "observations": ["string", ...]}',
    "cleanedText: the answer with obvious typos/formatting noise cleaned up, preserving the student's intended wording and meaning as closely as possible. Never add content the student did not write.",
    "observations: brief factual notes about readability, language, or formatting only (e.g. \"contains repeated characters\", \"mixed languages\"). Do not comment on whether the content is correct.",
  ].join("\n");

  const userPrompt = `Question:\n${params.questionText}\n\nStudent answer:\n${params.normalizedAnswerText}`;

  const raw = await callStructuredAi<RawAiAnswerReading>({
    model: READ_MODEL,
    systemPrompt,
    userPrompt,
    stage: "ANSWER_READING_AI",
  });

  return validate(raw);
}

function validate(raw: RawAiAnswerReading): AiAnswerReadingResult {
  if (typeof raw.readability !== "string" || !VALID_READABILITY.has(raw.readability)) {
    throw new Error("AI answer-reading response had a missing or invalid readability value.");
  }
  if (typeof raw.cleanedText !== "string") {
    throw new Error("AI answer-reading response was missing cleanedText.");
  }

  const observations = Array.isArray(raw.observations)
    ? raw.observations.filter((o): o is string => typeof o === "string")
    : [];

  return {
    ...stageResultBase("ANSWER_READING_AI"),
    readability: raw.readability as AiReadability,
    cleanedText: raw.cleanedText,
    observations,
  };
}
