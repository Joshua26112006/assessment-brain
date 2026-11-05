import { describe, expect, it } from "vitest";
import { parseNumericExpression, parseNumericSet } from "@/lib/structuredCorrection/numericExpression";

/** Equal to within floating-point noise, relative to the value's size. */
function expectValue(input: string, expected: number | null) {
  const actual = parseNumericExpression(input);
  if (expected === null) {
    expect(actual, `${JSON.stringify(input)} should not be readable as a number`).toBeNull();
    return;
  }
  expect(actual, `${JSON.stringify(input)} should be readable as a number`).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(Math.abs(expected) * 1e-9);
}

describe("parseNumericExpression — behaviour that existed before the unit/answer-line fixes (plan Appendix A.1)", () => {
  it.each<[string, number]>([
    ["4", 4],
    ["8", 8],
    ["1/2", 0.5],
    ["5/12", 5 / 12],
    ["(15-9)/(30-10-8)", 0.5],
    ["20 x 10", 200],
    ["20 × 10", 200],
    ["20 X 10", 200],
    ["34.17 approximately", 34.17],
    ["36.67 marks (approximately)", 36.67],
    ["0.25 mol", 0.25],
    ["120 J", 120],
    ["10 ohm", 10],
    ["2000 g", 2000],
    ["5 cm", 5],
    ["-5", -5],
    ["+5", 5],
    ["1.5", 1.5],
    ["((2))", 2],
    ["3 - -2", 5],
    ["007", 7],
    ["4.", 4],
    ["9.81", 9.81],
    ["12 kg", 12],
    ["7 days", 7],
    ["1/2 m", 0.5],
  ])("%j → %d", (input, expected) => {
    expectValue(input, expected);
  });

  it("keeps the documented limitation that a hyphenated range reads as a subtraction", () => {
    expectValue("30-40", -10);
  });

  it("no longer reads an algebraic term as a number (Phase 7): 4x and 2e are not 4 and 2", () => {
    expectValue("2x", null);
    expectValue("2e", null);
    expectValue("4x", null);
    expectValue("3xy", null);
  });

  it("but a unit still strips, glued or spaced: 5 g and 2 m keep working", () => {
    expectValue("5 g", 5);
    expectValue("2 m", 2);
    expectValue("5g", 5);
    expectValue("120J", 120);
    expectValue("10 kg", 10);
  });

  it.each([
    "",
    "abc",
    "x",
    "3x^2",
    "2x+3",
    "three",
    "1/0",
    "(4",
    "4)",
    "a/b",
    // A percentage and a decimal comma are read only when the question accepts them (see ParseOptions).
    "50%",
    "2,5",
  ])("%j is not a number", (input) => {
    expectValue(input, null);
  });
});

describe("parseNumericExpression — √ and π (Phase 7)", () => {
  it.each<[string, number]>([
    ["√2", Math.SQRT2],
    ["2√3", 2 * Math.sqrt(3)],
    ["√(2+7)", 3],
    ["√ 9", 3],
    ["sqrt(16)", 4],
    ["π", Math.PI],
    ["4π", 4 * Math.PI],
    ["π/2", Math.PI / 2],
    ["2 π", 2 * Math.PI],
    ["pi", Math.PI],
    ["x = 3√2", 3 * Math.SQRT2],
    ["A = 25π cm²", 25 * Math.PI],
  ])("%j → %d", (input, expected) => {
    expect(parseNumericExpression(input)).toBeCloseTo(expected, 10);
  });

  it("a square root of a negative number is not a number", () => {
    expect(parseNumericExpression("√-4")).toBeNull();
    expect(parseNumericExpression("√(1-5)")).toBeNull();
  });

  it("does not rewrite ordinary words that contain 'pi' or 'sqrt'", () => {
    expect(parseNumericExpression("spin")).toBeNull();
    expect(parseNumericExpression("the pie")).toBeNull();
  });
});

describe("parseNumericExpression — mixed numbers (Phase 7)", () => {
  it.each<[string, number]>([
    ["2 1/2", 2.5],
    ["3 3/4", 3.75],
    ["10 1/4 m", 10.25],
    ["0 1/2", 0.5],
  ])("%j → %d", (input, expected) => {
    expectValue(input, expected);
  });

  it("only when the whole value is that form: '2 1/2 + 1' is not a mixed number", () => {
    expect(parseNumericExpression("2 1/2 + 1")).toBeNull();
  });

  it("a mixed number over zero is not a number", () => {
    expect(parseNumericExpression("2 1/0")).toBeNull();
  });
});

describe("parseNumericExpression — percentages and decimal commas are read only when asked for (Phase 7)", () => {
  it("a percentage is a fraction of a hundred when the question accepts one", () => {
    expect(parseNumericExpression("50%", { acceptPercent: true })).toBe(0.5);
    expect(parseNumericExpression("12.5 %", { acceptPercent: true })).toBe(0.125);
    expect(parseNumericExpression("(20+30)%", { acceptPercent: true })).toBe(0.5);
  });

  it("and is not a number otherwise", () => {
    expect(parseNumericExpression("50%")).toBeNull();
    expect(parseNumericExpression("50%", { acceptPercent: false })).toBeNull();
  });

  it("a decimal comma is a decimal point when declared", () => {
    expect(parseNumericExpression("2,5", { decimalComma: true })).toBe(2.5);
    expect(parseNumericExpression("0,25 mol", { decimalComma: true })).toBe(0.25);
  });

  it("a comma is still a thousands separator when no decimal comma is declared", () => {
    expect(parseNumericExpression("1,000")).toBe(1000);
    expect(parseNumericExpression("1,00,000")).toBe(100000);
    expect(parseNumericExpression("2,5")).toBeNull();
  });
});

describe("parseNumericExpression — recurring decimals (Phase 7)", () => {
  it("a trailing ellipsis says 'and so on'; the digits written are the value", () => {
    expect(parseNumericExpression("0.333...")).toBeCloseTo(0.333, 9);
    expect(parseNumericExpression("0.66…")).toBeCloseTo(0.66, 9);
  });

  it("a bar over a digit is not read: it is not a number the parser can be sure of", () => {
    expect(parseNumericExpression("0.3̅")).toBeNull();
    expect(parseNumericExpression("0.(3)")).toBeNull();
  });
});

describe("parseNumericSet — an answer with more than one value (Phase 7)", () => {
  it.each<[string, number[]]>([
    ["x = 2 or x = -3", [-3, 2]],
    ["2 or -3", [-3, 2]],
    ["x = 2 and x = 5", [2, 5]],
    ["±2", [-2, 2]],
    ["x = ±3", [-3, 3]],
    ["Ans: 1 or 4", [1, 4]],
    ["x = 4 or x = 4 or x = 1", [1, 4]],
    ["x = −2 or x = 3", [-2, 3]],
  ])("%j → %j", (input, expected) => {
    expect(parseNumericSet(input)).toEqual(expected);
  });

  it.each(["4", "x = 4", "x = 4 or x = 4", "±0", "two or three", "x = 2 or abc", "", "1,2,3", "2, 5"])(
    "%j is not a set",
    (input) => {
      expect(parseNumericSet(input)).toBeNull();
    },
  );

  it("a surd inside a set is evaluated", () => {
    const set = parseNumericSet("x = ±√2")!;
    expect(set[0]).toBeCloseTo(-Math.SQRT2, 10);
    expect(set[1]).toBeCloseTo(Math.SQRT2, 10);
  });
});

describe("parseNumericExpression — compound units", () => {
  it.each<[string, number]>([
    ["4 m/s^2", 4],
    ["4 m/s²", 4],
    ["(20-0)/5 m/s^2", 4],
    ["9.8 m/s²", 9.8],
    ["10 Ω", 10],
    ["10Ω", 10],
    ["37 °C", 37],
    ["5 N/m²", 5],
    ["20 kg m/s", 20],
    ["20 kg·m/s", 20],
    ["3 J/(kg K)", 3],
    ["100 kPa", 100],
    ["5 µF", 5],
    ["3 m s^-1", 3],
    ["3 m s⁻¹", 3],
    ["25 km/h", 25],
    ["5 eV", 5],
    ["2.4 Ω", 2.4],
  ])("%j → %d", (input, expected) => {
    expectValue(input, expected);
  });

  it.each(["4 foo/bar", "4 q/s", "5 apples/day", "m/s^2", "Ω", "°C", "4 m//s", "4 m/s^", "2x^2", "2 x^2"])(
    "%j is not a number (only recognised unit symbols may be dropped)",
    (input) => {
      expectValue(input, null);
    },
  );
});

describe("parseNumericExpression — final answer lines", () => {
  it.each<[string, number]>([
    ["x = 4", 4],
    ["x=4", 4],
    ["Ans: 4", 4],
    ["Answer = 4", 4],
    ["∴ x = 4", 4],
    ["= 4", 4],
    ["therefore 12", 12],
    ["a = (20-0)/5 = 4", 4],
    ["a = (20 - 0)/5 = 4 m/s^2", 4],
    ["a = (v-u)/t = (20-0)/5 = 4 m/s²", 4],
    ["P(prime) = 1/2", 0.5],
    ["R_eq = 2.4 Ω", 2.4],
    ["x = −3", -3],
  ])("%j → %d", (input, expected) => {
    expectValue(input, expected);
  });

  it.each([
    "x = 3 + 4 = 8", // contradicts itself part-way: not read as whichever half is last
    "2x + 3 = 11", // an equation, not an answer
    "2x = 8",
    "x >= 4",
    "x ≥ 4",
    "x ≠ 4",
    "x = 2 or x = -3", // several values: Phase 7
  ])("%j is not read as a single answer", (input) => {
    expectValue(input, null);
  });
});

describe("parseNumericExpression — number forms", () => {
  it.each<[string, number]>([
    ["−5", -5],
    ["1,000", 1000],
    ["1,00,000", 100000],
    ["12,345.6", 12345.6],
    ["3 x 10^8", 3e8],
    ["3.0 × 10⁸ m/s", 3e8],
    ["3e8", 3e8],
    ["1.6E-19", 1.6e-19],
    ["1.6 × 10^-19 C", 1.6e-19],
    ["6.02 × 10²³", 6.02e23],
    ["2^3", 8],
    ["-2^2", -4],
    ["10^(-3)", 0.001],
  ])("%j → %d", (input, expected) => {
    expectValue(input, expected);
  });

  it.each([
    "2,5", // may be a decimal comma or a list
    "2, 5",
    "1,2,3",
    "x^2",
    "10^999", // overflow is unreadable, not Infinity
  ])("%j is not a number", (input) => {
    expectValue(input, null);
  });
});
