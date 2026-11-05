import { describe, expect, it } from "vitest";
import { explanationAgreesWithFinding, studentValueIsInTranscription, withoutUnsupportedErrors } from "@/lib/structuredCorrection/findingChecks";
import type { ComparisonResult } from "@/types/structuredCorrection";

describe("studentValueIsInTranscription (the verifier checks the student's side too)", () => {
  const err = (raw: string, parsed: number | null) => ({ actual: { raw, parsed } });

  it("accepts a quote that is in the transcription", () => {
    expect(studentValueIsInTranscription(err("120 J", 120), "W = mgh\n= 2 x 10 x 5\n= 120 J")).toBe(true);
  });

  it("accepts the same number written another way", () => {
    expect(studentValueIsInTranscription(err("120", 120), "W = 2 x 10 x 5 = 120 J")).toBe(true);
    expect(studentValueIsInTranscription(err("0.5", 0.5), "the answer is 1/2")).toBe(true);
  });

  it("rejects a quote the student never wrote", () => {
    expect(studentValueIsInTranscription(err("150 J", 150), "W = 2 x 10 x 5 = 100 J")).toBe(false);
  });

  it("has nothing to check when no value was quoted (a missing step)", () => {
    expect(studentValueIsInTranscription({}, "anything")).toBe(true);
    expect(studentValueIsInTranscription(err("", null), "anything")).toBe(true);
  });

  it("ignores case and repeated spaces, but a quote with different internal spacing is not the same text", () => {
    expect(studentValueIsInTranscription(err("Sardar Patel", null), "the leader was sardar   patel")).toBe(true);
    expect(studentValueIsInTranscription(err("W =  120J", null), "w = 120j")).toBe(true); // runs of spaces collapse
  });

  it("a non-numeric quote that is not there is rejected", () => {
    expect(studentValueIsInTranscription(err("Nehru", null), "the answer is Patel")).toBe(false);
  });
});

describe("withoutUnsupportedErrors", () => {
  const comparisonWith = (errors: Array<{ id: string; raw?: string; parsed?: number; dependsOn?: string[]; variable?: string }>): ComparisonResult => ({
    status: "compared",
    matchedApproachLabel: null,
    errors: errors.map((e) => ({
      id: e.id,
      type: "ARITHMETIC_ERROR",
      ...(e.variable ? { variable: e.variable } : {}),
      ...(e.raw !== undefined ? { actual: { raw: e.raw, parsed: e.parsed ?? null } } : {}),
      comparisonMethod: "numeric",
      dependsOn: e.dependsOn ?? [],
    })) as never,
    matchedVariableCount: 0,
    totalExpectedVariableCount: 0,
  });

  it("keeps findings that quote something really written", () => {
    const c = comparisonWith([{ id: "e0", raw: "120", parsed: 120 }]);
    expect(withoutUnsupportedErrors(c, "= 120 J").errors).toHaveLength(1);
  });

  it("drops a finding quoting a value that is not there", () => {
    const c = comparisonWith([{ id: "e0", raw: "999", parsed: 999 }]);
    expect(withoutUnsupportedErrors(c, "= 120 J").errors).toEqual([]);
  });

  it("drops a consequence of a dropped finding too: it would stand on nothing", () => {
    const c = comparisonWith([
      { id: "e0", raw: "999", parsed: 999, variable: "m" },
      { id: "e1", raw: "120", parsed: 120, dependsOn: ["e0"] },
    ]);
    expect(withoutUnsupportedErrors(c, "= 120 J").errors).toEqual([]);
  });

  it("returns the same comparison when nothing is dropped", () => {
    const c = comparisonWith([{ id: "e0", raw: "120", parsed: 120 }]);
    expect(withoutUnsupportedErrors(c, "120")).toBe(c);
  });

  it("returns a comparison with no findings untouched", () => {
    const c = comparisonWith([]);
    expect(withoutUnsupportedErrors(c, "x")).toBe(c);
  });
});

describe("explanationAgreesWithFinding (wording must not bring in numbers the finding does not have)", () => {
  const error = { variable: "m", expected: { raw: "100", parsed: 100 }, actual: { raw: "120", parsed: 120 } };

  it("accepts a sentence that uses only the key's value and the student's", () => {
    expect(explanationAgreesWithFinding("The value here should be 100, but you wrote 120.", error)).toBe(true);
  });

  it("rejects a sentence that brings in a number from nowhere", () => {
    expect(explanationAgreesWithFinding("2 x 10 x 5 should be 100, not 120.", error)).toBe(false);
    expect(explanationAgreesWithFinding("The value should be 100, but you wrote 150.", error)).toBe(false);
  });

  it("allows a rounded form of an allowed value", () => {
    expect(explanationAgreesWithFinding("It should be about 2.45.", { expected: { raw: "2.449", parsed: 2.449 }, actual: { raw: "2.5", parsed: 2.5 } })).toBe(true);
  });

  it("does not count digits that are part of the quantity's name or of 'step 2'", () => {
    expect(explanationAgreesWithFinding("In step 2 the value of f1 should be 15, not 9.", { variable: "f1", expected: { raw: "15", parsed: 15 }, actual: { raw: "9", parsed: 9 } })).toBe(true);
  });

  it("a sentence with no numbers always agrees", () => {
    expect(explanationAgreesWithFinding("Check this part again.", error)).toBe(true);
  });
});
