import { describe, expect, it } from "vitest";
import { applyNumberFormats } from "@/lib/structuredCorrection/numberFormats";
import { finalAnswerVerdict } from "@/lib/structuredCorrection/comparisonEngine";
import { numberFormatsApply, schemeOf } from "@/lib/scheme/criteria";
import type { ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

const reading = (answerRaw: string): ReconciledReading =>
  ({
    questionNumber: 1,
    transcription: `answer = ${answerRaw}`,
    steps: [],
    variables: { efficiency: { raw: answerRaw, parsed: null } },
    studentAnswer: { raw: answerRaw, parsed: null },
    attempted: true,
    agreementConfidence: "high",
    structureConfidence: "high",
  }) as unknown as ReconciledReading;

const expectation = (answerRaw: string): StructuredExpectation => ({
  solvable: true,
  problemType: "unknown",
  correctAnswer: { raw: answerRaw, parsed: null },
  approaches: [{ label: "a", formulaName: "f", formulaExpression: "e", variables: { efficiency: { raw: answerRaw, parsed: null } } }],
});

describe("applyNumberFormats", () => {
  it("changes nothing when neither form is accepted", () => {
    const r = reading("40%");
    const out = applyNumberFormats(r, expectation("40%"), { acceptPercent: false, decimalComma: false });
    expect(out.reading).toBe(r);
    expect(out.reading.studentAnswer?.parsed).toBeNull();
  });

  it("changes nothing when the scheme has no settings", () => {
    const r = reading("40%");
    expect(applyNumberFormats(r, null, undefined).reading).toBe(r);
  });

  it("reads a percentage as a fraction on both sides when percentages are accepted", () => {
    const out = applyNumberFormats(reading("40%"), expectation("40%"), { acceptPercent: true, decimalComma: false });
    expect(out.reading.studentAnswer?.parsed).toBeCloseTo(0.4);
    expect(out.reading.variables.efficiency.parsed).toBeCloseTo(0.4);
    expect(out.expectation?.correctAnswer?.parsed).toBeCloseTo(0.4);
    expect(out.expectation?.approaches[0].variables.efficiency.parsed).toBeCloseTo(0.4);
  });

  it("reads a decimal comma only when it is accepted", () => {
    expect(applyNumberFormats(reading("2,5"), null, { acceptPercent: true, decimalComma: false }).reading.studentAnswer?.parsed).toBeNull();
    expect(applyNumberFormats(reading("2,5"), null, { acceptPercent: false, decimalComma: true }).reading.studentAnswer?.parsed).toBe(2.5);
  });

  it("never changes a value that already had a number", () => {
    const r = reading("12");
    r.studentAnswer = { raw: "12", parsed: 12 };
    const out = applyNumberFormats(r, null, { acceptPercent: true, decimalComma: true });
    expect(out.reading.studentAnswer?.parsed).toBe(12);
  });

  it("lets the comparison judge a percentage answer once it is read", () => {
    const formats = { acceptPercent: true, decimalComma: false };
    const right = applyNumberFormats(reading("40%"), expectation("40%"), formats);
    expect(finalAnswerVerdict(right.reading, right.expectation)).toBe(true);
    const wrong = applyNumberFormats(reading("30%"), expectation("40%"), formats);
    expect(finalAnswerVerdict(wrong.reading, wrong.expectation)).toBe(false);
  });
});

describe("number-format settings of a scheme", () => {
  it("are off unless ticked, and read from the stored version", () => {
    expect(schemeOf({}, 2).numberFormats).toEqual({ acceptPercent: false, decimalComma: false });
    expect(schemeOf({ acceptPercent: true, decimalComma: null }, 2).numberFormats).toEqual({ acceptPercent: true, decimalComma: false });
  });

  it("are offered only where there is a number to check", () => {
    expect(numberFormatsApply([{ kind: "STEP" }, { kind: "FINAL_ANSWER" }])).toBe(true);
    expect(numberFormatsApply([{ kind: "VALUE" }])).toBe(true);
    expect(numberFormatsApply([{ kind: "VALUE_POINT" }, { kind: "LEVEL" }])).toBe(false);
    expect(numberFormatsApply([{ kind: "EXACT_KEY" }])).toBe(false);
  });
});
