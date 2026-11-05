/**
 * Strict JSON schemas for the two marking replies, sent to the provider as structured output (callStructured.ts).
 * They describe exactly what parseCriterionReply and parseMethodCheck already expect; those parsers still validate
 * every reply, so a schema can only make a malformed reply rarer, never stand in for a check.
 *
 * Strict schemas need every property in `required` and `additionalProperties: false`.
 */

export const CRITERION_REPLY_SCHEMA = {
  name: "criterion_marking",
  schema: {
    type: "object",
    properties: {
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            met: { type: "string", enum: ["yes", "no", "partial"] },
            usesEarlierError: { type: "boolean" },
            evidence: { type: "string" },
          },
          required: ["id", "met", "usesEarlierError", "evidence"],
          additionalProperties: false,
        },
      },
      feedback: { type: "string" },
    },
    required: ["criteria", "feedback"],
    additionalProperties: false,
  },
} as const;

export const METHOD_CHECK_SCHEMA = {
  name: "method_check",
  schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["valid", "invalid", "unclear"] },
      reason: { type: "string" },
    },
    required: ["verdict", "reason"],
    additionalProperties: false,
  },
} as const;
