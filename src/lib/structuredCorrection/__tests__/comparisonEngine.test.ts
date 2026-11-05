import { describe, expect, it } from "vitest";
import { compareReadingToRubric, numericTolerance } from "@/lib/structuredCorrection/comparisonEngine";
import { parseNumericExpression } from "@/lib/structuredCorrection/numericExpression";
import { splitQuantity } from "@/lib/structuredCorrection/units";
import type { ExtractedValue, ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

/** Like production: the unit written with a value is kept alongside the number our own parser reads. */
const value = (raw: string): ExtractedValue => {
  const unit = splitQuantity(raw).unitText;
  return { raw, parsed: parseNumericExpression(raw), ...(unit ? { unit } : {}) };
};
const values = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).map(([name, raw]) => [name, value(raw)]));

interface ReadingSpec {
  transcription: string;
  variables?: Record<string, string>;
  answer?: string;
  /** What the other reading pass saw. Defaults to the same as the main pass; null = only one pass ran. */
  second?: { variables?: Record<string, string>; answer?: string } | null;
  structureConfidence?: ReconciledReading["structureConfidence"];
  agreementConfidence?: ReconciledReading["agreementConfidence"];
  attempted?: boolean;
}

function reading(spec: ReadingSpec): ReconciledReading {
  const answer = spec.answer;
  const main: ReconciledReading = {
    questionNumber: 1,
    transcription: spec.transcription,
    attempted: spec.attempted ?? true,
    agreementConfidence: spec.agreementConfidence ?? "high",
    problemType: "unknown",
    steps: [],
    variables: values(spec.variables ?? {}),
    studentAnswer: answer ? value(answer) : null,
    structureConfidence: spec.structureConfidence ?? "high",
  };
  if (spec.second === null) {
    main.secondPass = null;
  } else {
    const secondAnswer = spec.second?.answer ?? answer;
    main.secondPass = {
      variables: values(spec.second?.variables ?? spec.variables ?? {}),
      studentAnswer: secondAnswer ? value(secondAnswer) : null,
    };
  }
  return main;
}

function rubric(correctAnswer: string, variables: Record<string, string>): StructuredExpectation {
  return {
    solvable: true,
    problemType: "unknown",
    correctAnswer: value(correctAnswer),
    approaches: [{ label: "Method", formulaName: "", formulaExpression: "", variables: values(variables) }],
  };
}

/** "TYPE(variable)" for every finding, so a scenario's whole outcome reads as one list. */
function findings(r: ReconciledReading, e: StructuredExpectation): string[] {
  const result = compareReadingToRubric(r, e);
  if (result.status !== "compared") return [result.status];
  return result.errors.map((error) => `${error.type}${error.variable ? `(${error.variable})` : ""}`);
}

describe("compareReadingToRubric — correct work must produce no findings", () => {
  it("correct physics answer with a compound unit and unnamed values", () => {
    const r = reading({ transcription: "a = (v - u)/t = (20 - 0)/5 = 4 m/s^2", answer: "4 m/s^2" });
    expect(findings(r, rubric("4", { u: "0", v: "20", t: "5" }))).toEqual([]);
  });

  it("correct answer written as 'x = 4'", () => {
    const r = reading({ transcription: "2x + 3 = 11\n2x = 8\nx = 4", answer: "x = 4" });
    expect(findings(r, rubric("4", { a: "2", b: "3", c: "11" }))).toEqual([]);
  });

  it("scientific notation", () => {
    const r = reading({ transcription: "v = f λ = 3 x 10^8 m/s", answer: "3 x 10^8 m/s" });
    expect(findings(r, rubric("3e8", { f: "6e14", l: "5e-7" }))).toEqual([]);
  });

  it("typeset minus sign", () => {
    const r = reading({ transcription: "x = −3", answer: "x = −3" });
    expect(findings(r, rubric("-3", { a: "1" }))).toEqual([]);
  });

  it("thousands separator", () => {
    const r = reading({ transcription: "Total = 1,000", answer: "1,000" });
    expect(findings(r, rubric("1000", { n: "10" }))).toEqual([]);
  });

  it("rounded to 1 decimal place (2.4 for 2.449)", () => {
    const r = reading({ transcription: "x = sqrt(6) = 2.4", answer: "2.4" });
    expect(findings(r, rubric("2.449", { n: "6" }))).toEqual([]);
  });

  it("rounded to 2 decimal places (0.33 for 1/3)", () => {
    const r = reading({ transcription: "P = 2/6 = 0.33", answer: "0.33" });
    expect(findings(r, rubric("1/3", { fav: "2", total: "6" }))).toEqual([]);
  });

  it("an equation as the final line makes no claim", () => {
    const r = reading({ transcription: "2x = 8", answer: "2x = 8" });
    expect(findings(r, rubric("4", { a: "2" }))).toEqual([]);
  });

  it("an answer that cannot be evaluated (50%) makes no claim", () => {
    const r = reading({ transcription: "P = 50%", answer: "50%" });
    expect(findings(r, rubric("0.5", { n: "2" }))).toEqual([]);
  });
});

describe("compareReadingToRubric — answers that are not numeric are not compared", () => {
  it("a correct balanced equation is skipped, not 'missed step a'", () => {
    const r = reading({ transcription: "2H2 + O2 -> 2H2O", answer: "2H2 + O2 -> 2H2O" });
    expect(findings(r, rubric("2H2 + O2 -> 2H2O", { a: "2", b: "1", c: "2" }))).toEqual(["skipped_not_numeric"]);
  });

  it("a name answer is skipped", () => {
    const r = reading({ transcription: "Sardar Patel", answer: "Sardar Patel" });
    expect(findings(r, rubric("Jawaharlal Nehru", { x: "1" }))).toEqual(["skipped_not_numeric"]);
  });
});

describe("compareReadingToRubric — real mistakes are still reported", () => {
  it("unnamed substitution with an arithmetic slip: the slip only, no 'missing m, g, h'", () => {
    const r = reading({ transcription: "W = mgh = 2 x 10 x 5 = 120 J", answer: "120 J" });
    expect(findings(r, rubric("100", { m: "2", g: "10", h: "5" }))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("a value that genuinely never appears is reported missing", () => {
    const r = reading({ transcription: "W = mg = 2 x 10 = 20 J", answer: "20 J" });
    expect(findings(r, rubric("100", { m: "2", g: "10", h: "5" }))).toEqual(["MISSING_STEP(h)", "ARITHMETIC_ERROR"]);
  });

  it("a named wrong substitution carries the final answer error as its consequence", () => {
    const r = reading({
      transcription: "m = 3, g = 10, h = 5\nW = 150",
      variables: { m: "3", g: "10", h: "5" },
      answer: "150",
    });
    expect(findings(r, rubric("100", { m: "2", g: "10", h: "5" }))).toEqual([
      "WRONG_SUBSTITUTION(m)",
      "FINAL_ANSWER_ERROR",
    ]);
  });

  it("a whole-number answer for 2.45 is not accepted as rounding", () => {
    const r = reading({ transcription: "= 2", answer: "2" });
    // The only rubric variable (a = 2.45) IS the final answer, so it is not reported a second time as "missing".
    expect(findings(r, rubric("2.45", { a: "2.45" }))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("a rubric quantity that is the final answer again is not reported on top of the final answer", () => {
    const r = reading({ transcription: "R = 2 ohm", answer: "2" });
    expect(findings(r, rubric("2.4", { R_eq: "2.4", r1: "4", r2: "6" }))).not.toContain("MISSING_STEP(R_eq)");
  });

  it("wrong rounding (2.5 for 2.449) is reported", () => {
    const r = reading({ transcription: "x = 2.5", answer: "2.5" });
    expect(findings(r, rubric("2.449", { n: "6" }))).toEqual(["MISSING_STEP(n)", "ARITHMETIC_ERROR"]);
  });

  it("right magnitude, wrong sign", () => {
    const r = reading({ transcription: "x = 3", answer: "x = 3" });
    expect(findings(r, rubric("-3", { a: "1" }))).toEqual(["MISSING_STEP(a)", "SIGN_ERROR"]);
  });

  it("small values are not 'equal' just because both are under the old absolute floor", () => {
    const r = reading({ transcription: "c = 0.002 M", answer: "0.002" });
    expect(findings(r, rubric("0.008", { n: "1" }))).toEqual(["MISSING_STEP(n)", "ARITHMETIC_ERROR"]);
  });
});

describe("compareReadingToRubric — names and cases", () => {
  it("rubric M (molarity) is not matched to student m (mass) as a wrong value", () => {
    const r = reading({ transcription: "m = 40\nn = 0.05\nmass = 2 g", variables: { m: "40", n: "0.05" }, answer: "2 g" });
    expect(findings(r, rubric("2", { M: "0.2", n: "0.05" }))).toEqual([]);
  });

  it("a case-only name match never produces a wrong-substitution claim, even with a wrong answer", () => {
    const r = reading({ transcription: "m = 40, moles = 50, mass = 2000 g", variables: { m: "40" }, answer: "2000 g" });
    expect(findings(r, rubric("2", { M: "0.2" }))).toEqual([]);
  });
});

describe("compareReadingToRubric — the two reading passes", () => {
  it("a final answer the two passes read differently (7 vs 1) makes no claim", () => {
    const r = reading({ transcription: "x = 7", answer: "7", second: { answer: "1" } });
    expect(findings(r, rubric("1", { a: "1" }))).toEqual([]);
  });

  it("a variable value the passes read differently gives no wrong-substitution", () => {
    const r = reading({
      transcription: "m = 5",
      variables: { m: "5" },
      answer: "100",
      second: { variables: { m: "S" }, answer: "100" },
    });
    expect(findings(r, rubric("100", { m: "2" }))).toEqual([]);
  });

  it("a value the other pass found is not reported missing", () => {
    const r = reading({ transcription: "...", answer: "50", second: { variables: { h: "5" }, answer: "50" } });
    expect(findings(r, rubric("100", { h: "5" }))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("a single successful pass makes no claims", () => {
    const r = reading({ transcription: "W = 120", answer: "120", second: null, agreementConfidence: "low" });
    expect(findings(r, rubric("100", { m: "2" }))).toEqual(["skipped_low_confidence"]);
  });

  it("a low structure confidence makes no claims", () => {
    const r = reading({ transcription: "smudged", answer: "120", structureConfidence: "low" });
    expect(findings(r, rubric("100", { m: "2" }))).toEqual(["skipped_low_confidence"]);
  });
});

describe("compareReadingToRubric — units (a key that carries its unit)", () => {
  it("2000 mg for an expected 2 g is correct: a real conversion, not a guess", () => {
    const r = reading({ transcription: "mass = 2000 mg", answer: "2000 mg" });
    expect(findings(r, rubric("2 g", {}))).toEqual([]);
  });

  it("2000 g for an expected 2 g is wrong: the same slip a missing conversion would hide", () => {
    const r = reading({ transcription: "mass = 2000 g", answer: "2000 g" });
    expect(findings(r, rubric("2 g", {}))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("250 mL for an expected 0.25 L is correct", () => {
    const r = reading({ transcription: "V = 250 mL", answer: "250 mL" });
    expect(findings(r, rubric("0.25 L", {}))).toEqual([]);
  });

  it("forgetting to convert mL to L is caught: 250 L for an expected 0.25 L", () => {
    const r = reading({ transcription: "V = 250 L", answer: "250 L" });
    expect(findings(r, rubric("0.25 L", {}))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("an equivalent unit written differently is correct: 10 kg m/s^2 for 10 N", () => {
    const r = reading({ transcription: "F = 10 kg m/s^2", answer: "10 kg m/s^2" });
    expect(findings(r, rubric("10 N", {}))).toEqual([]);
  });

  it("a different quantity makes no claim about the value (5 m for an expected 5 s): the UNIT criterion judges it", () => {
    const r = reading({ transcription: "t = 5 m", answer: "5 m" });
    expect(findings(r, rubric("5 s", {}))).toEqual([]);
  });

  it("a unit the module does not know makes no claim", () => {
    const r = reading({ transcription: "d = 5 furlongs", answer: "5 furlongs" });
    expect(findings(r, rubric("1000 m", {}))).toEqual([]);
  });

  it("no unit written compares the bare numbers", () => {
    expect(findings(reading({ transcription: "m = 2", answer: "2" }), rubric("2 g", {}))).toEqual([]);
    expect(findings(reading({ transcription: "m = 3", answer: "3" }), rubric("2 g", {}))).toEqual(["ARITHMETIC_ERROR"]);
  });

  it("a key with no unit keeps the older cautious rule: a power-of-ten difference with a unit written makes no claim", () => {
    const r = reading({ transcription: "mass = 2000 mg", answer: "2000 mg" });
    expect(findings(r, rubric("2", { n: "0.05" }))).toEqual([]);
  });

  it("converts the unit of the key's own variables too", () => {
    const r = reading({ transcription: "m = 2000 mg, answer 2 g", variables: { m: "2000 mg" }, answer: "2 g" });
    expect(findings(r, rubric("2 g", { m: "2 g" }))).toEqual([]);
  });
});

describe("compareReadingToRubric — statuses", () => {
  it("an unattempted question is skipped, not a set of mistakes", () => {
    const r = reading({ transcription: "", attempted: false });
    expect(findings(r, rubric("4", { a: "1" }))).toEqual(["skipped_not_attempted"]);
  });

  it("a question the rubric declared unsolvable is skipped", () => {
    const r = reading({ transcription: "an essay", answer: "x" });
    const unsolvable: StructuredExpectation = {
      solvable: false,
      unsolvableReason: "conceptual_question",
      problemType: "unknown",
      correctAnswer: null,
      approaches: [],
    };
    expect(findings(r, unsolvable)).toEqual(["skipped_unsolvable"]);
  });

  it("no expectation at all is skipped", () => {
    const r = reading({ transcription: "x", answer: "1" });
    expect(compareReadingToRubric(r, null).status).toBe("skipped_no_expectation");
  });
});

describe("numericTolerance", () => {
  it("keeps the 0.01 floor for values of 0.2 and above", () => {
    expect(numericTolerance(0.2)).toBeCloseTo(0.01, 12);
    expect(numericTolerance(1)).toBeCloseTo(0.01, 12);
  });

  it("shrinks for small values so 0.002 and 0.008 are not equal", () => {
    expect(numericTolerance(0.008)).toBeLessThan(0.006);
  });

  it("is relative for large values", () => {
    expect(numericTolerance(1000)).toBeCloseTo(5, 9);
  });
});

describe("compareReadingToRubric — variable aliases (a student names a quantity differently)", () => {
  const key = (aliases?: Record<string, string[]>): StructuredExpectation => {
    const base = rubric("100", { u: "8", a: "2" });
    return aliases ? { ...base, approaches: [{ ...base.approaches[0], aliases }] } : base;
  };
  const wrongInitial = () =>
    reading({ transcription: "initial speed = 3, a = 2, answer 120", variables: { "initial speed": "3", a: "2" }, answer: "120" });

  it("without an alias the student's differently-named value is not found, so the quantity reads as missing", () => {
    expect(findings(wrongInitial(), key())).toContain("MISSING_STEP(u)");
  });

  it("with the alias the value is found, and a wrong one is reported as a wrong substitution, not as missing", () => {
    const result = findings(wrongInitial(), key({ u: ["initial speed", "v0"] }));
    expect(result).toContain("WRONG_SUBSTITUTION(u)");
    expect(result).not.toContain("MISSING_STEP(u)");
  });

  it("a correct value under an alias raises nothing", () => {
    const r = reading({ transcription: "initial speed = 8, a = 2, answer 100", variables: { "initial speed": "8", a: "2" }, answer: "100" });
    expect(findings(r, key({ u: ["initial speed"] }))).toEqual([]);
  });

  it("an alias the student never wrote changes nothing", () => {
    expect(findings(wrongInitial(), key({ u: ["v0"] }))).toContain("MISSING_STEP(u)");
  });
});
