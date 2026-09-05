import type {
  ExpectedResponseLength,
  QuestionUnderstandingInput,
  QuestionUnderstandingResult,
  PipelineStage,
} from "@/types/pipeline";
import { extractKeyTerms } from "@/lib/pipeline/text";
import { stageResultBase } from "@/lib/pipeline/stageResult";

/**
 * Deterministic placeholder: buckets expected response length from the
 * question's own maximumMarks (a real, existing, durable field — not a
 * semantic read of the question), and extracts key terms via simple
 * tokenization. A future NLP/LLM stage can replace term extraction and
 * length classification without changing this contract.
 */
export const understandQuestion: PipelineStage<QuestionUnderstandingInput, QuestionUnderstandingResult> = (
  input,
) => {
  const warnings: string[] = [];
  if (!input.questionText.trim()) {
    warnings.push("Question text is empty.");
  }

  return {
    ...stageResultBase("QUESTION_UNDERSTANDING", warnings),
    expectedResponseLength: classifyExpectedLength(input.maximumMarks),
    keyTerms: extractKeyTerms(input.questionText),
  };
};

function classifyExpectedLength(maximumMarks: number): ExpectedResponseLength {
  if (maximumMarks <= 2) return "SHORT";
  if (maximumMarks <= 6) return "MEDIUM";
  return "EXTENDED";
}
