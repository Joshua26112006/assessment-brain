import { describe, expect, it } from "vitest";
import { mergeAliases, standardAliases } from "@/lib/structuredCorrection/variableAliases";
import { compareReadingToRubric } from "@/lib/structuredCorrection/comparisonEngine";
import type { ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

describe("standardAliases", () => {
  it("gives the usual other names for a school symbol", () => {
    expect(standardAliases("u")).toEqual(expect.arrayContaining(["v0", "initial velocity"]));
    expect(standardAliases("v")).toEqual(expect.arrayContaining(["vf", "final velocity"]));
  });

  it("works the other way: the words lead to the symbol", () => {
    expect(standardAliases("initial velocity")).toContain("u");
    expect(standardAliases("Initial Velocity")).toContain("u");
  });

  it("says nothing about a name that means different things in different questions", () => {
    expect(standardAliases("d")).toEqual([]);
    expect(standardAliases("Q")).toEqual([]);
    expect(standardAliases("r")).toEqual([]);
  });

  it("says nothing about an unknown name", () => {
    expect(standardAliases("R_eq")).toEqual([]);
  });
});

describe("mergeAliases", () => {
  it("keeps the scheme's own aliases first and adds the standard ones without repeats", () => {
    const merged = mergeAliases("u", ["velocity at start", "v0"]);
    expect(merged.slice(0, 2)).toEqual(["velocity at start", "v0"]);
    expect(merged.filter((alias) => alias === "v0")).toHaveLength(1);
    expect(merged).toContain("initial velocity");
  });

  it("never lists the quantity as its own alias", () => {
    expect(mergeAliases("u", ["U"])).not.toContain("U");
  });
});

const value = (raw: string) => ({ raw, parsed: Number(raw) });
const expectation: StructuredExpectation = {
  solvable: true,
  problemType: "unknown",
  correctAnswer: value("20"),
  approaches: [{ label: "v = u + at", formulaName: "v = u + at", formulaExpression: "v = u + a*t", variables: { u: value("0"), a: value("4"), t: value("5") } }],
};
const reading = (variables: Record<string, string>, answer: string): ReconciledReading =>
  ({
    questionNumber: 1,
    transcription: Object.entries(variables).map(([k, v]) => `${k} = ${v}`).join("\n") + `\nv = ${answer}`,
    steps: ["v = u + at", `v = ${answer}`],
    variables: Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, value(v)])),
    studentAnswer: value(answer),
    attempted: true,
    agreementConfidence: "high",
    structureConfidence: "high",
  }) as unknown as ReconciledReading;

describe("a student who names the quantities differently", () => {
  it("is matched through the standard names, so a wrong value is no longer missed", () => {
    // The student wrote v0 = 3 where the rubric's u is 0 and, by luck, still reached the right answer.
    const result = compareReadingToRubric(reading({ v0: "3", a: "4", t: "5" }, "20"), expectation);
    expect(result.errors.some((error) => error.variable === "u")).toBe(true);
  });

  it("makes no claim about a quantity the student did not write under any name", () => {
    const result = compareReadingToRubric(reading({ a: "4", t: "5" }, "20"), expectation);
    expect(result.errors.some((error) => error.variable === "u")).toBe(false);
  });
});
