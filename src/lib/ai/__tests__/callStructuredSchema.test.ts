import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/ai/openrouter", () => ({ getOpenRouterClient: () => ({ chat: { completions: { create } } }) }));
vi.mock("@/lib/ai/usageLog", () => ({ recordAiCallUsage: async () => {} }));

import { callStructuredAi, isSchemaRefusal } from "@/lib/ai/callStructured";
import { CRITERION_REPLY_SCHEMA, METHOD_CHECK_SCHEMA } from "@/lib/structuredCorrection/replySchemas";
import { parseCriterionReply } from "@/lib/structuredCorrection/criterionResults";
import { parseMethodCheck } from "@/lib/structuredCorrection/alternativeMethod";

const reply = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const base = { model: "m", systemPrompt: "s", userPrompt: "u", stage: "STRUCTURED_SCORING" };

describe("structured output", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(reply);
  });

  it("sends a strict schema when the caller supplies one", async () => {
    await callStructuredAi({ ...base, jsonSchema: METHOD_CHECK_SCHEMA });
    expect(create.mock.calls[0][0].response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "method_check", strict: true, schema: METHOD_CHECK_SCHEMA.schema },
    });
  });

  it("sends nothing extra when there is no schema", async () => {
    await callStructuredAi(base);
    expect(create.mock.calls[0][0].response_format).toBeUndefined();
  });

  it("asks again without the schema when the provider refuses it, and still returns the reply", async () => {
    create.mockRejectedValueOnce(Object.assign(new Error("unsupported schema"), { status: 400 }));
    expect(await callStructuredAi({ ...base, jsonSchema: METHOD_CHECK_SCHEMA })).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].response_format).toBeUndefined();
  });

  it("does not drop the schema for an ordinary failure such as a server error", async () => {
    create.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    await callStructuredAi({ ...base, jsonSchema: METHOD_CHECK_SCHEMA, maxAttempts: 2 });
    expect(create.mock.calls.every((call) => call[0].response_format !== undefined)).toBe(true);
  });

  it("recognises a refusal only by a 400 or 422", () => {
    expect(isSchemaRefusal({ status: 400 })).toBe(true);
    expect(isSchemaRefusal({ status: 422 })).toBe(true);
    expect(isSchemaRefusal({ status: 402 })).toBe(false);
    expect(isSchemaRefusal(new Error("x"))).toBe(false);
    expect(isSchemaRefusal(null)).toBe(false);
  });
});

describe("the schemas match what the parsers read", () => {
  it("a reply shaped like the criterion schema is parsed in full", () => {
    const parsed = parseCriterionReply(
      { criteria: [{ id: "c1", met: "yes", usesEarlierError: false, evidence: "W = F x d" }], feedback: "Well done." },
      ["c1"],
      "W = F x d",
    );
    expect(parsed.outcomes).toEqual([{ criterionId: "c1", met: "yes", evidence: "W = F x d" }]);
    expect(parsed.feedback).toBe("Well done.");
  });

  it("a reply shaped like the method schema is parsed", () => {
    expect(parseMethodCheck({ verdict: "valid", reason: "Fine." })).toEqual({ verdict: "valid", reason: "Fine." });
  });

  it("every property of both schemas is required and nothing else is allowed", () => {
    const check = (schema: { properties: Record<string, unknown>; required: readonly string[]; additionalProperties: boolean }) => {
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
      expect(schema.additionalProperties).toBe(false);
    };
    check(METHOD_CHECK_SCHEMA.schema);
    check(CRITERION_REPLY_SCHEMA.schema);
    check(CRITERION_REPLY_SCHEMA.schema.properties.criteria.items);
  });
});
