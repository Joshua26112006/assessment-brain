import { describe, expect, it } from "vitest";
import { answerTypeOf, exactKeyOf } from "@/lib/questions/answerType";
import type { SchemeCriterion } from "@/lib/scheme/criteria";

const c = (kind: SchemeCriterion["kind"], extra: Partial<SchemeCriterion> = {}): SchemeCriterion => ({ id: "c1", kind, description: "d", marks: 1, ...extra });

describe("answerTypeOf", () => {
  it("a type the teacher confirmed always wins", () => {
    expect(answerTypeOf({ answerType: "DIAGRAM", criteria: [c("EXACT_KEY", { accepted: ["B"] })], numericSolvable: true })).toBe("DIAGRAM");
  });

  it("ignores a stored value that is not a known type", () => {
    expect(answerTypeOf({ answerType: "WIZARD", criteria: [], numericSolvable: false })).toBe("DESCRIPTIVE");
  });

  it("is an exact key when every criterion is an exact answer", () => {
    expect(answerTypeOf({ criteria: [c("EXACT_KEY", { accepted: ["B"] })], numericSolvable: false })).toBe("EXACT_KEY");
  });

  it("is an essay when the scheme has a quality level", () => {
    expect(answerTypeOf({ criteria: [c("VALUE_POINT"), c("LEVEL")], numericSolvable: false })).toBe("ESSAY");
  });

  it("is numeric when the rubric found one definite numeric answer", () => {
    expect(answerTypeOf({ criteria: [c("STEP"), c("FINAL_ANSWER")], numericSolvable: true })).toBe("NUMERIC");
  });

  it("is descriptive otherwise, which is also what a question with no scheme reads as", () => {
    expect(answerTypeOf({ criteria: [c("VALUE_POINT")], numericSolvable: false })).toBe("DESCRIPTIVE");
    expect(answerTypeOf({ criteria: [], numericSolvable: false })).toBe("DESCRIPTIVE");
  });

  it("an exact key mixed with other criteria is not an exact key", () => {
    expect(answerTypeOf({ criteria: [c("EXACT_KEY", { accepted: ["x"] }), c("STEP")], numericSolvable: false })).toBe("DESCRIPTIVE");
  });
});

describe("exactKeyOf", () => {
  it("returns the accepted answers and the marks for a single exact-answer criterion", () => {
    expect(exactKeyOf([c("EXACT_KEY", { accepted: [" Paris ", "paris", ""], marks: 2 })])).toEqual({ accepted: ["Paris", "paris"], marks: 2 });
  });

  it("is null when it is not that shape: nothing for code to decide alone", () => {
    expect(exactKeyOf([])).toBeNull();
    expect(exactKeyOf([c("FINAL_ANSWER")])).toBeNull();
    expect(exactKeyOf([c("EXACT_KEY", { accepted: ["a"] }), c("EXACT_KEY", { id: "c2", accepted: ["b"] })])).toBeNull();
    expect(exactKeyOf([c("EXACT_KEY", { accepted: [] })])).toBeNull();
  });
});
