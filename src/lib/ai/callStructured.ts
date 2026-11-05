import { getOpenRouterClient } from "@/lib/ai/openrouter";
import { parseAiJson } from "@/lib/ai/json";
import { withRetry } from "@/lib/ai/retry";
import { recordAiCallUsage } from "@/lib/ai/usageLog";
import type { StructuredAiCallOptions, StructuredAiCallWithContentOptions } from "@/lib/ai/types";

/**
 * The most a reply may run to when a caller names no limit. Without one the provider is asked for the model's whole
 * output limit (65,536 tokens here), which reserves far more credit than any of these replies use and was refused outright
 * once a key's balance ran low. A caller whose reply can be longer says so itself (the whole-sheet read, a question paper).
 */
export const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Sends one structured-JSON chat request to OpenRouter and returns the
 * parsed (but NOT contract-validated) response body. Every caller must
 * still validate the returned shape against its own stage contract before
 * trusting it — this only guarantees "syntactically parseable JSON was
 * extracted from the model's text," nothing about its semantic shape.
 *
 * Retries a bounded number of times (network/transient failures); throws
 * on exhaustion or on unparseable output after retries. Callers are
 * expected to catch this and fall back to deterministic behavior — this
 * function does not swallow failures itself.
 */
export async function callStructuredAi<T>(options: StructuredAiCallOptions): Promise<T> {
  const client = getOpenRouterClient();

  const create = (withSchema: boolean) =>
    client.chat.completions.create({
      model: options.model,
      temperature: options.temperature ?? 0.2,
      seed: options.seed,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
      ...(withSchema && options.jsonSchema
        ? { response_format: { type: "json_schema" as const, json_schema: { name: options.jsonSchema.name, strict: true, schema: options.jsonSchema.schema } } }
        : {}),
    });
  // Once a provider has refused the schema, later attempts of this call do not send it again.
  let schemaRefused = false;

  const { text, usage } = await withRetry(
    async () => {
      let completion;
      try {
        completion = await create(!schemaRefused);
      } catch (error) {
        if (options.jsonSchema && !schemaRefused && isSchemaRefusal(error)) {
          schemaRefused = true;
          completion = await create(false);
        } else {
          throw error;
        }
      }

      const text = completion.choices[0]?.message?.content;
      if (!text || typeof text !== "string") {
        throw new Error("AI response contained no text content.");
      }
      return { text, usage: completion.usage };
    },
    { maxAttempts: options.maxAttempts ?? 2 },
  );

  await recordAiCallUsage({
    model: options.model,
    stage: options.stage,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    context: options.context,
  });

  return parseAiJson<T>(text);
}

/** A provider answering 400 or 422 to a request that carried a schema: it does not accept that schema, so ask without it. */
export function isSchemaRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 422;
}

/**
 * Like callStructuredAi, but the user turn carries multimodal content parts
 * (text plus images and/or files) instead of a single string — the same
 * OpenRouter client, retry policy, and JSON-extraction logic, just with a
 * richer message shape. This is the ONLY other way any stage sends a chat
 * request; no second client or provider is introduced to support it (see
 * src/lib/questionPaperExtraction/ai.ts, its one current caller).
 *
 * `ChatCompletionContentPart` (from the `openai` package already used by
 * getOpenRouterClient) supports `image_url` parts (base64 data URIs) and
 * `file` parts (base64 `file_data`, used here for PDFs) — OpenRouter accepts
 * both and forwards them to whichever configured model receives the call.
 */
export async function callStructuredAiWithContent<T>(
  options: StructuredAiCallWithContentOptions,
): Promise<T> {
  const client = getOpenRouterClient();

  const create = (withSchema: boolean) =>
    client.chat.completions.create({
      model: options.model,
      temperature: options.temperature ?? 0.2,
      seed: options.seed,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userContent },
      ],
      ...(withSchema && options.jsonSchema
        ? { response_format: { type: "json_schema" as const, json_schema: { name: options.jsonSchema.name, strict: true, schema: options.jsonSchema.schema } } }
        : {}),
    });
  // Once a provider has refused the schema, later attempts of this call do not send it again.
  let schemaRefused = false;

  const { text, usage } = await withRetry(
    async () => {
      let completion;
      try {
        completion = await create(!schemaRefused);
      } catch (error) {
        if (options.jsonSchema && !schemaRefused && isSchemaRefusal(error)) {
          schemaRefused = true;
          completion = await create(false);
        } else {
          throw error;
        }
      }

      const text = completion.choices[0]?.message?.content;
      if (!text || typeof text !== "string") {
        throw new Error("AI response contained no text content.");
      }
      return { text, usage: completion.usage };
    },
    { maxAttempts: options.maxAttempts ?? 2 },
  );

  await recordAiCallUsage({
    model: options.model,
    stage: options.stage,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    context: options.context,
  });

  return parseAiJson<T>(text);
}
