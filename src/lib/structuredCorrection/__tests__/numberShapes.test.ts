import { describe, expect, it } from "vitest";
import {
  expandRecurring,
  parseCoordinate,
  parseInterval,
  parseNumericExpression,
  parseStructuredValue,
} from "@/lib/structuredCorrection/numericExpression";
import { finalAnswerVerdict, sameShape } from "@/lib/structuredCorrection/comparisonEngine";
import type { ExtractedValue, ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

describe("recurring decimals", () => {
  it("reads a bar over each repeating digit", () => {
    expect(parseNumericExpression("0.3\u0305")).toBeCloseTo(1 / 3, 10);
    expect(parseNumericExpression("0.1\u03052\u0305")).toBeCloseTo(12 / 99, 10);
    expect(parseNumericExpression("0.16\u0305")).toBeCloseTo(1 / 6, 10);
  });

  it("reads dots over the first and last repeating digit", () => {
    expect(parseNumericExpression("0.3\u0307")).toBeCloseTo(1 / 3, 10);
    expect(parseNumericExpression("0.1\u03072\u0307")).toBeCloseTo(12 / 99, 10);
  });

  it("reads the transcribed LaTeX forms", () => {
    expect(parseNumericExpression("0.\\overline{3}")).toBeCloseTo(1 / 3, 10);
    expect(parseNumericExpression("0.1\\overline{6}")).toBeCloseTo(1 / 6, 10);
    expect(parseNumericExpression("2.\\overline{45}")).toBeCloseTo(2 + 45 / 99, 10);
    expect(parseNumericExpression("0.\\dot{3}")).toBeCloseTo(1 / 3, 10);
  });

  it("leaves text without a mark alone", () => {
    expect(expandRecurring("0.333")).toBe("0.333");
    expect(parseNumericExpression("0.333")).toBeCloseTo(0.333);
  });
});

describe("ordered pairs", () => {
  it("reads (2, 3), with or without a name, keeping the order", () => {
    expect(parseCoordinate("(2, 3)")).toEqual([2, 3]);
    expect(parseCoordinate("P(2,3)")).toEqual([2, 3]);
    expect(parseCoordinate("A = (-1, 4)")).toEqual([-1, 4]);
    expect(parseCoordinate("(1, 2, 3)")).toEqual([1, 2, 3]);
  });

  it("does not read what is not a pair", () => {
    expect(parseCoordinate("2, 3")).toBeNull();
    expect(parseCoordinate("(2)")).toBeNull();
    expect(parseCoordinate("(a, b)")).toBeNull();
  });
});

describe("intervals", () => {
  it("reads bracket notation with open and closed ends", () => {
    expect(parseInterval("[1, 5)")).toEqual({ lo: 1, hi: 5, loOpen: false, hiOpen: true });
    expect(parseInterval("(-∞, 3]")).toEqual({ lo: -Infinity, hi: 3, loOpen: true, hiOpen: false });
    expect(parseInterval("x ∈ (2, ∞)")).toEqual({ lo: 2, hi: Infinity, loOpen: true, hiOpen: true });
  });

  it("does not read an inequality or a backwards interval", () => {
    expect(parseInterval("1 < x ≤ 5")).toBeNull();
    expect(parseInterval("[5, 1]")).toBeNull();
  });
});

describe("parseStructuredValue", () => {
  it("keeps a single number as a number", () => {
    expect(parseStructuredValue("4")).toEqual({ parsed: 4 });
  });

  it("keeps a set, an interval and a pair in their own shape", () => {
    expect(parseStructuredValue("x = 2 or -3")).toMatchObject({ parsed: null, parsedSet: [-3, 2] });
    expect(parseStructuredValue("[1, 5)")).toMatchObject({ parsed: null, parsedInterval: { lo: 1, hi: 5 } });
    expect(parseStructuredValue("(2, 3)")).toMatchObject({ parsed: null, parsedTuple: [2, 3] });
  });
});

const value = (raw: string): ExtractedValue => ({ raw, ...parseStructuredValue(raw) });
const reading = (answer: string): ReconciledReading =>
  ({ questionNumber: 1, transcription: answer, steps: [], variables: {}, studentAnswer: value(answer), attempted: true, agreementConfidence: "high", structureConfidence: "high" }) as unknown as ReconciledReading;
const key = (answer: string): StructuredExpectation => ({ solvable: true, problemType: "unknown", correctAnswer: value(answer), approaches: [] });

describe("judging an interval or an ordered pair", () => {
  it("is right only when the whole thing matches, in order", () => {
    expect(finalAnswerVerdict(reading("(2, 3)"), key("(2, 3)"))).toBe(true);
    expect(finalAnswerVerdict(reading("(3, 2)"), key("(2, 3)"))).toBe(false);
    expect(finalAnswerVerdict(reading("(2, 4)"), key("(2, 3)"))).toBe(false);
  });

  it("tells open from closed ends", () => {
    expect(finalAnswerVerdict(reading("[1, 5)"), key("[1, 5)"))).toBe(true);
    expect(finalAnswerVerdict(reading("[1, 5]"), key("[1, 5)"))).toBe(false);
    expect(finalAnswerVerdict(reading("[1, 5]"), key("(1, 5)"))).toBe(false);
  });

  it("does not call a different kind of answer wrong", () => {
    expect(finalAnswerVerdict(reading("4"), key("(2, 3)"))).toBeNull();
    expect(sameShape(value("(2, 3)"), value("4"))).toBeNull();
  });

  it("asks a person when the two reading passes disagreed", () => {
    const r = reading("(2, 3)");
    r.secondPass = { studentAnswer: value("(2, 8)") } as never;
    expect(finalAnswerVerdict(r, key("(2, 3)"))).toBeNull();
  });
});
