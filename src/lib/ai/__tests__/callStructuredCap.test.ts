import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/ai/openrouter", () => ({ getOpenRouterClient: () => ({ chat: { completions: { create } } }) }));
vi.mock("@/lib/ai/usageLog", () => ({ recordAiCallUsage: async () => {} }));

import { callStructuredAi, callStructuredAiWithContent, DEFAULT_MAX_TOKENS } from "@/lib/ai/callStructured";

const reply = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };

describe("the most a reply may run to", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(reply);
  });

  it("is capped by default, so the provider is not asked for the model's whole output limit", async () => {
    await callStructuredAi({ model: "m", systemPrompt: "s", userPrompt: "u", stage: "STRUCTURED_SCORING" });
    expect(create.mock.calls[0][0].max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(DEFAULT_MAX_TOKENS).toBeLessThan(65_536);
  });

  it("is capped by default for a request with images too", async () => {
    await callStructuredAiWithContent({ model: "m", systemPrompt: "s", userContent: [], stage: "STRUCTURED_READING" });
    expect(create.mock.calls[0][0].max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("uses the caller's own limit when it names one", async () => {
    await callStructuredAi({ model: "m", systemPrompt: "s", userPrompt: "u", maxTokens: 1200, stage: "STRUCTURED_SCORING" });
    expect(create.mock.calls[0][0].max_tokens).toBe(1200);
  });
});
