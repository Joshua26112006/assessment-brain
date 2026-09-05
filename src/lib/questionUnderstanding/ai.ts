import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAi } from "@/lib/ai/callStructured";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import type { AiQuestionUnderstandingResult } from "@/types/pipeline";

interface RawAiQuestionUnderstanding {
  questionIntent?: unknown;
  keyConcepts?: unknown;
  expectedReasoning?: unknown;
  ambiguities?: unknown;
}

/**
 * AI-assisted semantic reading of the question. Enrichment only — never
 * produces a grade, never replaces the teacher's rubric (Phase 2.2 Step 5).
 */
export async function understandQuestionWithAi(params: {
  questionText: string;
  maximumMarks: number;
}): Promise<AiQuestionUnderstandingResult> {
  const systemPrompt = [
    "You analyze an exam question to help a separate grading system understand it.",
    "You do not grade any answer and you do not create or modify any marking rubric.",
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"questionIntent": "string", "keyConcepts": ["string", ...], "expectedReasoning": ["string", ...], "ambiguities": ["string", ...]}',
    "questionIntent: one concise sentence stating what the question actually asks.",
    "keyConcepts: the concepts a strong answer should address.",
    "expectedReasoning: the kind of reasoning or steps a strong answer would show.",
    "ambiguities: only genuine ambiguities in how the question is worded; return an empty array if there are none. Do not invent problems with the question.",
  ].join("\n");

  const userPrompt = `Question (worth ${params.maximumMarks} marks):\n${params.questionText}`;

  const raw = await callStructuredAi<RawAiQuestionUnderstanding>({
    model: READ_MODEL,
    systemPrompt,
    userPrompt,
  });

  return validate(raw);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function validate(raw: RawAiQuestionUnderstanding): AiQuestionUnderstandingResult {
  if (typeof raw.questionIntent !== "string" || !raw.questionIntent.trim()) {
    throw new Error("AI question-understanding response was missing questionIntent.");
  }

  return {
    ...stageResultBase("QUESTION_UNDERSTANDING_AI"),
    questionIntent: raw.questionIntent,
    keyConcepts: toStringArray(raw.keyConcepts),
    expectedReasoning: toStringArray(raw.expectedReasoning),
    ambiguities: toStringArray(raw.ambiguities),
  };
}
