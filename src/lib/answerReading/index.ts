import type { AnswerReadingInput, AnswerReadingResult, PipelineStage } from "@/types/pipeline";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Reads QuestionResponse.studentAnswer (untyped JSON) into normalized text.
 *
 * Deterministic placeholder: the current student-answer format is always
 * `{ text: string }` (see the student "take assessment" flow) — there's no
 * OCR/handwriting input yet. A future OCR/handwriting stage would produce
 * the same AnswerReadingResult shape from a different rawAnswer format
 * without this contract needing to change.
 */
export const readAnswer: PipelineStage<AnswerReadingInput, AnswerReadingResult> = (input) => {
  const warnings: string[] = [];

  const text = extractAnswerText(input.rawAnswer, warnings);

  if (text === null) {
    return {
      ...stageResultBase("ANSWER_READING", warnings),
      status: "UNREADABLE",
      normalizedText: "",
      characterCount: 0,
      wordCount: 0,
    };
  }

  const normalizedText = text.trim().replace(/\s+/g, " ");

  return {
    ...stageResultBase("ANSWER_READING", warnings),
    status: normalizedText.length === 0 ? "BLANK" : "READ",
    normalizedText,
    characterCount: normalizedText.length,
    wordCount: normalizedText.length === 0 ? 0 : normalizedText.split(" ").length,
  };
};

function extractAnswerText(rawAnswer: unknown, warnings: string[]): string | null {
  if (rawAnswer === null || rawAnswer === undefined) {
    return "";
  }
  if (
    typeof rawAnswer === "object" &&
    "text" in rawAnswer &&
    typeof (rawAnswer as { text: unknown }).text === "string"
  ) {
    return (rawAnswer as { text: string }).text;
  }
  warnings.push("studentAnswer did not match the expected { text: string } shape.");
  return null;
}
