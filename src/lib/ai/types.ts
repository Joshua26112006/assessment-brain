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
}

/** Metadata about how a structured AI call went, for observability/warnings. */
export interface AiCallMetadata {
  model: string;
  attempts: number;
  durationMs: number;
}
