import { getOpenRouterClient } from "@/lib/ai/openrouter";
import { parseAiJson } from "@/lib/ai/json";
import { withRetry } from "@/lib/ai/retry";
import type { StructuredAiCallOptions, StructuredAiCallWithContentOptions } from "@/lib/ai/types";

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

  const content = await withRetry(
    async () => {
      const completion = await client.chat.completions.create({
        model: options.model,
        temperature: options.temperature ?? 0.2,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
      });

      const text = completion.choices[0]?.message?.content;
      if (!text || typeof text !== "string") {
        throw new Error("AI response contained no text content.");
      }
      return text;
    },
    { maxAttempts: options.maxAttempts ?? 2 },
  );

  return parseAiJson<T>(content);
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

  const content = await withRetry(
    async () => {
      const completion = await client.chat.completions.create({
        model: options.model,
        temperature: options.temperature ?? 0.2,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userContent },
        ],
      });

      const text = completion.choices[0]?.message?.content;
      if (!text || typeof text !== "string") {
        throw new Error("AI response contained no text content.");
      }
      return text;
    },
    { maxAttempts: options.maxAttempts ?? 2 },
  );

  return parseAiJson<T>(content);
}
