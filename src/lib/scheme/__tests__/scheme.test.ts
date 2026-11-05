import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_THROUGH,
  DEFAULT_NO_WORKING_RULE,
  criteriaFromCheckpoints,
  isHalfMarkMultiple,
  isSchemeApproved,
  schemeOf,
  snapToHalfMarks,
  validateCriteria,
  type SchemeCriterion,
} from "@/lib/scheme/criteria";
import { computeMarks, partialMarks, type CriterionOutcome, type MarkingRules } from "@/lib/scheme/marking";

const c = (id: string, kind: SchemeCriterion["kind"], marks: number, extra: Partial<SchemeCriterion> = {}): SchemeCriterion => ({
  id,
  kind,
  description: `criterion ${id}`,
  marks,
  ...extra,
});

describe("isHalfMarkMultiple", () => {
  it.each([0.5, 1, 1.5, 2, 4])("accepts %d", (v) => expect(isHalfMarkMultiple(v)).toBe(true));
  it.each([0.25, 1.3, 2.37, Number.NaN, Number.POSITIVE_INFINITY])("rejects %d", (v) => expect(isHalfMarkMultiple(v)).toBe(false));
});

describe("validateCriteria", () => {
  const five = [c("a", "STEP", 1), c("b", "VALUE", 1), c("c", "STEP", 1), c("d", "STEP", 1), c("e", "FINAL_ANSWER", 1)];

  it("accepts criteria that add up exactly to the question's marks", () => {
    expect(validateCriteria(five, 5)).toEqual({ ok: true, errors: [] });
  });

  it("accepts half marks", () => {
    expect(validateCriteria([c("a", "STEP", 1.5), c("b", "UNIT", 0.5), c("c", "FINAL_ANSWER", 2)], 4).ok).toBe(true);
  });

  it("rejects a total that does not match", () => {
    const result = validateCriteria(five, 6);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/add up to 5 marks, but the question is worth 6/);
  });

  it("rejects a criterion that is not a multiple of half a mark", () => {
    const result = validateCriteria([c("a", "STEP", 2.37), c("b", "FINAL_ANSWER", 1.63)], 4);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/multiple of 0\.5/);
  });

  it("rejects zero, negative, empty and repeated ids", () => {
    expect(validateCriteria([c("a", "STEP", 0), c("b", "STEP", 1)], 1).ok).toBe(false);
    expect(validateCriteria([c("a", "STEP", -1), c("b", "STEP", 2)], 1).ok).toBe(false);
    expect(validateCriteria([], 4).ok).toBe(false);
    expect(validateCriteria([c("a", "STEP", 1), c("a", "STEP", 1)], 2).errors.join(" ")).toMatch(/repeated id/);
  });

  it("requires an exact-answer criterion to list an accepted answer", () => {
    expect(validateCriteria([c("a", "EXACT_KEY", 1)], 1).ok).toBe(false);
    expect(validateCriteria([c("a", "EXACT_KEY", 1, { accepted: ["B"] })], 1).ok).toBe(true);
  });
});

describe("snapToHalfMarks", () => {
  it("keeps the total exact and every share a multiple of 0.5", () => {
    const marks = snapToHalfMarks([2.37, 1.63], 4);
    expect(marks.reduce((a, b) => a + b, 0)).toBe(4);
    expect(marks.every(isHalfMarkMultiple)).toBe(true);
  });

  it("splits evenly when no weights are usable", () => {
    expect(snapToHalfMarks([0, 0, 0, 0], 2)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("never returns a negative share", () => {
    expect(snapToHalfMarks([5, -3, 1], 3).every((m) => m >= 0)).toBe(true);
  });

  it("handles one criterion", () => {
    expect(snapToHalfMarks([7], 3)).toEqual([3]);
  });
});

describe("criteriaFromCheckpoints", () => {
  it("turns older checkpoints into STEP criteria that add up to the maximum", () => {
    const criteria = criteriaFromCheckpoints(
      [
        { description: "Formula", marks: 1.33 },
        { description: "Substitution", marks: 1.33 },
        { description: "Answer", marks: 1.34 },
      ],
      4,
    );
    expect(criteria.every((x) => x.kind === "STEP")).toBe(true);
    expect(validateCriteria(criteria, 4).ok).toBe(true);
  });

  it("ignores checkpoints with no description", () => {
    expect(criteriaFromCheckpoints([{ description: "  ", marks: 1 }], 1)).toEqual([]);
  });
});

describe("schemeOf", () => {
  it("falls back to the school defaults", () => {
    const scheme = schemeOf({ markingCheckpoints: [{ description: "x", marks: 2 }] }, 2);
    expect(scheme.followThrough).toBe(DEFAULT_FOLLOW_THROUGH);
    expect(scheme.noWorkingRule).toBe(DEFAULT_NO_WORKING_RULE);
    expect(scheme.criteria).toHaveLength(1);
  });

  it("uses stored criteria and a stated rule over the defaults", () => {
    const scheme = schemeOf(
      { criteria: [c("a", "FINAL_ANSWER", 2)], followThrough: "NOT_ALLOWED", noWorkingRule: "FULL_MARKS", acceptedAlternatives: ["method B"] },
      2,
    );
    expect(scheme.followThrough).toBe("NOT_ALLOWED");
    expect(scheme.noWorkingRule).toBe("FULL_MARKS");
    expect(scheme.acceptedAlternatives).toEqual(["method B"]);
  });

  it("ignores an unknown rule value", () => {
    expect(schemeOf({ followThrough: "SOMETIMES" }, 1).followThrough).toBe(DEFAULT_FOLLOW_THROUGH);
  });
});

describe("isSchemeApproved", () => {
  it("is true only once a teacher has approved", () => {
    expect(isSchemeApproved({ approvedAt: new Date() })).toBe(true);
    expect(isSchemeApproved({ approvedAt: null })).toBe(false);
    expect(isSchemeApproved(undefined)).toBe(false);
    expect(isSchemeApproved(null)).toBe(false);
  });
});

describe("computeMarks", () => {
  // The spec's worked example: a 5-mark question where the student goes wrong at step 3.
  const criteria = [
    c("formula", "STEP", 1),
    c("subst", "VALUE", 1),
    c("calc", "STEP", 1),
    c("next", "STEP", 1),
    c("final", "FINAL_ANSWER", 1),
  ];
  const rules = (over: Partial<MarkingRules> = {}): MarkingRules => ({
    followThrough: "ALLOWED",
    noWorkingRule: "FINAL_ANSWER_ONLY",
    finalAnswerCorrect: false,
    hasWorking: true,
    ...over,
  });
  const outcomes = (carry: boolean): CriterionOutcome[] => [
    { criterionId: "formula", met: "yes" },
    { criterionId: "subst", met: "yes" },
    { criterionId: "calc", met: "no" },
    { criterionId: "next", met: "yes", usesEarlierError: carry },
    { criterionId: "final", met: "no" },
  ];

  it("is always the sum of the criteria", () => {
    const result = computeMarks(criteria, outcomes(false), rules());
    expect(result.marks).toBe(3);
    expect(result.maxMarks).toBe(5);
    expect(result.awards.map((a) => a.awarded)).toEqual([1, 1, 0, 1, 0]);
  });

  it("follow-through ALLOWED: a later step using an earlier wrong value still earns its mark (3/5)", () => {
    const result = computeMarks(criteria, outcomes(true), rules({ followThrough: "ALLOWED" }));
    expect(result.marks).toBe(3);
    expect(result.flags).toContain("FOLLOW_THROUGH_APPLIED");
  });

  it("follow-through NOT_ALLOWED: marks stop at the first error (2/5)", () => {
    const result = computeMarks(criteria, outcomes(true), rules({ followThrough: "NOT_ALLOWED" }));
    expect(result.marks).toBe(2);
    expect(result.awards[3].note).toMatch(/does not allow/);
  });

  it("follow-through METHOD_ONLY: a later method mark is kept but an accuracy mark is not", () => {
    const mixed: CriterionOutcome[] = [
      { criterionId: "formula", met: "yes" },
      { criterionId: "subst", met: "yes", usesEarlierError: true },
      { criterionId: "calc", met: "no" },
      { criterionId: "next", met: "yes", usesEarlierError: true },
      { criterionId: "final", met: "yes", usesEarlierError: true },
    ];
    const result = computeMarks(criteria, mixed, rules({ followThrough: "METHOD_ONLY" }));
    // subst (VALUE) and next (STEP) are method kinds and are kept; final (FINAL_ANSWER) is not.
    expect(result.awards.map((a) => a.awarded)).toEqual([1, 1, 0, 1, 0]);
  });

  it("D6: a correct answer with no working earns only the answer's marks and is flagged", () => {
    const allYes: CriterionOutcome[] = criteria.map((x) => ({ criterionId: x.id, met: "yes" as const }));
    const result = computeMarks(criteria, allYes, rules({ finalAnswerCorrect: true, hasWorking: false }));
    expect(result.marks).toBe(1);
    expect(result.flags).toContain("NO_WORKING");
    expect(result.flags).toContain("FINAL_ANSWER_CORRECT_NOT_FULL");
  });

  it("D6: a scheme that says FULL_MARKS gives full marks for a correct answer with no working, still flagged", () => {
    // No working was shown, so every method criterion reads "no"; the final answer itself is right.
    const none: CriterionOutcome[] = criteria.map((x) => ({ criterionId: x.id, met: x.kind === "FINAL_ANSWER" ? ("yes" as const) : ("no" as const) }));
    const result = computeMarks(criteria, none, rules({ finalAnswerCorrect: true, hasWorking: false, noWorkingRule: "FULL_MARKS" }));
    expect(result.marks).toBe(5);
    expect(result.flags).toContain("NO_WORKING");
  });

  it("does not apply the no-working rule when the answer is wrong or could not be judged", () => {
    const allYes: CriterionOutcome[] = criteria.map((x) => ({ criterionId: x.id, met: "yes" as const }));
    expect(computeMarks(criteria, allYes, rules({ finalAnswerCorrect: false, hasWorking: false })).flags).not.toContain("NO_WORKING");
    expect(computeMarks(criteria, allYes, rules({ finalAnswerCorrect: null, hasWorking: false })).marks).toBe(5);
  });

  it("gives half marks for a partial result, never below a half-mark step", () => {
    const result = computeMarks(
      [c("a", "STEP", 1), c("b", "STEP", 2), c("c", "UNIT", 0.5)],
      [
        { criterionId: "a", met: "partial" },
        { criterionId: "b", met: "partial" },
        { criterionId: "c", met: "partial" },
      ],
      rules(),
    );
    expect(result.awards.map((a) => a.awarded)).toEqual([0.5, 1, 0]);
    expect(result.flags).toContain("PARTIAL_NOT_ALLOWED");
  });

  it("a criterion with no result earns nothing and is flagged for the teacher", () => {
    const result = computeMarks(criteria, [{ criterionId: "formula", met: "yes" }], rules());
    expect(result.marks).toBe(1);
    expect(result.flags).toContain("UNKNOWN_CRITERION");
  });

  it("a result for an unknown criterion id changes nothing", () => {
    const result = computeMarks(criteria, [{ criterionId: "ghost", met: "yes" }], rules());
    expect(result.marks).toBe(0);
  });

  it("never exceeds the question's maximum, however many outcomes say yes", () => {
    const all: CriterionOutcome[] = criteria.map((x) => ({ criterionId: x.id, met: "yes" as const }));
    expect(computeMarks(criteria, all, rules({ finalAnswerCorrect: true })).marks).toBe(5);
  });
});

describe("partialMarks", () => {
  it.each([
    [1, 0.5],
    [1.5, 0.5],
    [2, 1],
    [3, 1.5],
    [0.5, 0],
  ])("half of %d is %d", (marks, expected) => {
    expect(partialMarks(marks)).toBe(expected);
  });
});
