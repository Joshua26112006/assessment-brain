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
  /**
   * Forwarded to the provider for reproducibility. Set it where the same input
   * ought to produce the same output on a rerun — awarding marks, for
   * instance, where two students' identical work must not score differently.
   */
  seed?: number;
  /**
   * Upper bound on the response length.
   *
   * Worth setting on every call: OpenRouter reserves credit for the FULL
   * requested output up front, so leaving this unset reserves the model's
   * entire output window and a pricier model then fails with a 402 that reads
   * as the model being unavailable. Set it high enough that a legitimate
   * response is never truncated — a cut-off response fails JSON parsing, which
   * is a worse failure than a slightly larger reservation.
   */
  maxTokens?: number;
  /**
   * Ask the provider to return JSON that follows this schema (strict structured output) rather than hoping the reply
   * is parseable. A provider that refuses the schema is asked again without it, and the reply is parsed and validated
   * by the caller exactly as before, so this can only reduce malformed replies, never replace the caller's checks.
   * The schema must be strict-compatible: every property listed in `required`, `additionalProperties: false`.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
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
  /**
   * Forwarded to the provider for reproducibility. Set it where the same input
   * ought to produce the same output on a rerun — awarding marks, for
   * instance, where two students' identical work must not score differently.
   */
  seed?: number;
  /**
   * Upper bound on the response length.
   *
   * Worth setting on every call: OpenRouter reserves credit for the FULL
   * requested output up front, so leaving this unset reserves the model's
   * entire output window and a pricier model then fails with a 402 that reads
   * as the model being unavailable. Set it high enough that a legitimate
   * response is never truncated — a cut-off response fails JSON parsing, which
   * is a worse failure than a slightly larger reservation.
   */
  maxTokens?: number;
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
