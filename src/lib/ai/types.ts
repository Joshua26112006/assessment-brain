import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

/**
 * Shared AI-infrastructure types — request/response plumbing only. Pipeline
 * *contracts* (what each stage produces) live in src/types/pipeline.ts;
 * nothing here duplicates those.
 */

/** Which of the company's three OpenRouter model roles a call used. */
export type AiModelRole = "READ" | "JUDGE" | "VERIFY";

export interface StructuredAiCallOptions {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Lower favors consistency, which matters for an evaluation pipeline. Default 0.2. */
  temperature?: number;
  maxAttempts?: number;
  /** The caller's own context label (e.g. "RUBRIC_GENERATION") — attributes AiCallLog rows back to a stage. */
  stage: string;
  /** Caller-supplied identifiers (questionId, submissionId, ...) for the AiCallLog row. Shape varies by stage. */
  context?: Record<string, unknown>;
}

/**
 * Like StructuredAiCallOptions, but the user turn is multimodal content
 * parts (text, images, files) instead of a single string — see
 * callStructuredAiWithContent, the only function that accepts this.
 */
export interface StructuredAiCallWithContentOptions {
  model: string;
  systemPrompt: string;
  userContent: ChatCompletionContentPart[];
  temperature?: number;
  maxAttempts?: number;
  /** The caller's own context label (e.g. "QUESTION_PAPER_EXTRACTION") — attributes AiCallLog rows back to a stage. */
  stage: string;
  /** Caller-supplied identifiers (questionId, submissionId, ...) for the AiCallLog row. Shape varies by stage. */
  context?: Record<string, unknown>;
}

/** Metadata about how a structured AI call went, for observability/warnings. */
export interface AiCallMetadata {
  model: string;
  attempts: number;
  durationMs: number;
}
