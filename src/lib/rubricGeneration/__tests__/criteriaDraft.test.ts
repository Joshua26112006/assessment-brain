import { describe, expect, it } from "vitest";
import { buildCriteriaFromDraft, criteriaWithFallback } from "@/lib/rubricGeneration/criteriaDraft";
import { validateCriteria } from "@/lib/scheme/criteria";

describe("buildCriteriaFromDraft", () => {
  it("keeps the model's relative weights and makes the total exactly the question's marks", () => {
    const criteria = buildCriteriaFromDraft(
      [
        { kind: "STEP", description: "Formula", marks: 1 },
        { kind: "VALUE", description: "Substitution", marks: 1 },
        { kind: "FINAL_ANSWER", description: "Answer", marks: 1.5 },
        { kind: "UNIT", description: "Unit", marks: 0.5, unit: "m/s" },
      ],
      4,
      "20 m/s",
    );
    expect(criteria.map((c) => c.marks)).toEqual([1, 1, 1.5, 0.5]);
    expect(validateCriteria(criteria, 4).ok).toBe(true);
    expect(criteria[3].unit).toBe("m/s");
  });

  it("rescales marks that do not add up, in half marks", () => {
    const criteria = buildCriteriaFromDraft(
      [
        { kind: "STEP", description: "a", marks: 2.37 },
        { kind: "FINAL_ANSWER", description: "b", marks: 2.37 },
      ],
      5,
      "x",
    );
    expect(validateCriteria(criteria, 5).ok).toBe(true);
    expect(criteria.reduce((s, c) => s + c.marks, 0)).toBe(5);
  });

  it("treats an unknown kind as a step rather than dropping it", () => {
    const criteria = buildCriteriaFromDraft([{ kind: "WIZARDRY", description: "x", marks: 2 }], 2, "x");
    expect(criteria[0].kind).toBe("STEP");
  });

  it("drops criteria without a description", () => {
    expect(buildCriteriaFromDraft([{ kind: "STEP", description: "  ", marks: 1 }], 1, "x")).toEqual([]);
  });

  it("gives an exact-answer criterion its accepted answers, deduplicated", () => {
    const criteria = buildCriteriaFromDraft(
      [{ kind: "EXACT_KEY", description: "Capital of France", marks: 1, accepted: ["Paris", "paris", " Paris ", "PARIS"] }],
      1,
      "Paris",
    );
    expect(criteria[0].accepted).toEqual(["Paris"]);
  });

  it("falls back to the expected answer as the key when none was listed", () => {
    const criteria = buildCriteriaFromDraft([{ kind: "EXACT_KEY", description: "Option", marks: 1 }], 1, "B");
    expect(criteria[0]).toMatchObject({ kind: "EXACT_KEY", accepted: ["B"] });
  });

  it("does not match a long expected answer exactly: it becomes a final-answer criterion", () => {
    const long = "The mitochondria is the organelle that produces most of the cell's usable chemical energy in the form of ATP.";
    const criteria = buildCriteriaFromDraft([{ kind: "EXACT_KEY", description: "Function", marks: 2 }], 2, long);
    expect(criteria[0].kind).toBe("FINAL_ANSWER");
  });

  it("returns nothing for a malformed response", () => {
    expect(buildCriteriaFromDraft(undefined, 4, "x")).toEqual([]);
    expect(buildCriteriaFromDraft("nope", 4, "x")).toEqual([]);
    expect(buildCriteriaFromDraft([], 4, "x")).toEqual([]);
    expect(buildCriteriaFromDraft([null, 3, "x"], 4, "x")).toEqual([]);
    expect(buildCriteriaFromDraft([{ kind: "STEP", description: "x", marks: 1 }], 0, "x")).toEqual([]);
  });

  it("splits the marks evenly when the model gave no usable weights", () => {
    const criteria = buildCriteriaFromDraft(
      [
        { kind: "STEP", description: "a" },
        { kind: "STEP", description: "b" },
      ],
      2,
      "x",
    );
    expect(criteria.map((c) => c.marks)).toEqual([1, 1]);
  });
});

describe("criteriaWithFallback", () => {
  it("prefers the model's criteria", () => {
    const criteria = criteriaWithFallback([{ kind: "FINAL_ANSWER", description: "ans", marks: 2 }], [{ description: "old", marks: 2 }], 2, "x");
    expect(criteria[0].kind).toBe("FINAL_ANSWER");
  });

  it("falls back to the older checkpoints as STEP criteria", () => {
    const criteria = criteriaWithFallback(undefined, [{ description: "old", marks: 2 }], 2, "x");
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toMatchObject({ kind: "STEP", description: "old", marks: 2 });
  });
});
