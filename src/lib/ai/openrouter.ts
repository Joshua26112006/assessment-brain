import OpenAI from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let client: OpenAI | null = null;

/**
 * Lazily initialized singleton OpenAI SDK client pointed at OpenRouter —
 * the company's single AI gateway. Not recreated on every call; the first
 * call constructs it, every later call reuses the same instance.
 *
 * Throws a clear, server-side-only error if OPENROUTER_API_KEY is missing,
 * rather than constructing a client that would fail confusingly on first
 * use. Never logs the key itself, only that it's absent.
 */
export function getOpenRouterClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. AI-assisted pipeline stages cannot run without it.",
    );
  }

  client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  return client;
}
