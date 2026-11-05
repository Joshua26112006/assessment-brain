import { describe, expect, it } from "vitest";
import { effectiveTree, paperTotals, wasAttempted } from "@/lib/questions/paperScore";

describe("wasAttempted", () => {
  it("is true for an answer with writing", () => {
    expect(wasAttempted({ text: "W = 100 J" })).toBe(true);
  });

  it("is false for a question recorded as not attempted, a blank, or nothing", () => {
    expect(wasAttempted({ text: "", notAttempted: true })).toBe(false);
    expect(wasAttempted({ text: "   " })).toBe(false);
    expect(wasAttempted(null)).toBe(false);
    expect(wasAttempted(undefined)).toBe(false);
  });

  it("is true for an answer shape with no text field (it exists)", () => {
    expect(wasAttempted({ selected: "B" })).toBe(true);
  });
});

describe("effectiveTree", () => {
  it("is flat when no tree is stored: every paper from before trees existed", () => {
    expect(effectiveTree(null, ["a", "b"])).toEqual({ nodes: [{ kind: "LEAF", questionId: "a" }, { kind: "LEAF", questionId: "b" }] });
  });

  it("falls back to flat when the stored tree does not fit the questions, so a total never disappears", () => {
    const stale = { nodes: [{ kind: "LEAF", questionId: "gone" }] };
    expect(effectiveTree(stale, ["a"]).nodes).toEqual([{ kind: "LEAF", questionId: "a" }]);
  });

  it("uses a valid stored tree", () => {
    const good = { nodes: [{ kind: "CHOICE", children: [{ kind: "LEAF", questionId: "a" }, { kind: "LEAF", questionId: "b" }] }] };
    expect(effectiveTree(good, ["a", "b"])).toEqual(good);
  });
});

describe("paperTotals", () => {
  const answers = (over: Partial<Record<string, { awardedMarks: number | null; attempted: boolean }>> = {}) =>
    ["a", "b"].map((questionId) => ({ questionId, maximumMarks: 5, awardedMarks: 0, attempted: false, ...over[questionId] }));

  it("adds a flat paper up", () => {
    const totals = paperTotals(null, answers({ a: { awardedMarks: 3, attempted: true }, b: { awardedMarks: 4, attempted: true } }));
    expect(totals).toMatchObject({ awarded: 7, maximum: 10 });
  });

  it("through a choice: counts the higher, and the paper is out of ONE alternative's marks", () => {
    const choice = { nodes: [{ kind: "CHOICE", children: [{ kind: "LEAF", questionId: "a" }, { kind: "LEAF", questionId: "b" }] }] };
    const totals = paperTotals(choice, answers({ a: { awardedMarks: 2, attempted: true }, b: { awardedMarks: 4, attempted: true } }));
    expect(totals).toMatchObject({ awarded: 4, maximum: 5 });
    expect(totals.perLeaf.get("a")).toEqual({ counted: false, overAttempt: true });
  });

  it("a zero recorded for an unattempted alternative is not an over attempt", () => {
    const choice = { nodes: [{ kind: "CHOICE", children: [{ kind: "LEAF", questionId: "a" }, { kind: "LEAF", questionId: "b" }] }] };
    const totals = paperTotals(choice, answers({ a: { awardedMarks: 3, attempted: true }, b: { awardedMarks: 0, attempted: wasAttempted({ text: "", notAttempted: true }) } }));
    expect(totals.perLeaf.get("b")).toEqual({ counted: false, overAttempt: false });
    expect(totals.awarded).toBe(3);
  });
});
