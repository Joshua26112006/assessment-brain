import { describe, expect, it } from "vitest";
import { reconcileFindingsWithMarks } from "@/lib/structuredCorrection/findings";
import type { MarkingDetail } from "@/lib/structuredCorrection/scoring";
import type { ComparisonResult, ErrorExplanation } from "@/types/structuredCorrection";

const explanation = (errorId: string): ErrorExplanation => ({ errorId, explanationType: "root_arithmetic_error", explanation: "x" });
const comparison = (errors: Array<{ id: string; variable?: string }>): ComparisonResult => ({
  status: "compared",
  matchedApproachLabel: null,
  errors: errors.map((e) => ({ id: e.id, type: "ARITHMETIC_ERROR", ...(e.variable ? { variable: e.variable } : {}), comparisonMethod: "numeric", dependsOn: [] })) as never,
  matchedVariableCount: 0,
  totalExpectedVariableCount: 0,
});
const marking = (awardedFinal: boolean): MarkingDetail => ({
  criteria: [
    { id: "c1", kind: "STEP", description: "s", maxMarks: 1, awarded: 1 },
    { id: "c2", kind: "FINAL_ANSWER", description: "a", maxMarks: 2, awarded: awardedFinal ? 2 : 0 },
  ],
  runTotals: [3],
  spread: 0,
  unsure: false,
  reasons: [],
  model: "m",
});

describe("reconcileFindingsWithMarks", () => {
  const base = { comparison: comparison([{ id: "err_0" }, { id: "err_1", variable: "m" }]), explanations: [explanation("err_0"), explanation("err_1")], maximumMarks: 3 };

  it("shows nothing to a student who earned full marks", () => {
    expect(reconcileFindingsWithMarks({ ...base, marking: marking(true), awardedMarks: 3 })).toEqual([]);
  });

  it("drops a finding about the final answer when the final answer was awarded, and keeps the rest", () => {
    const shown = reconcileFindingsWithMarks({ ...base, marking: marking(true), awardedMarks: 2 });
    expect(shown.map((e) => e.errorId)).toEqual(["err_1"]);
  });

  it("keeps every finding when the final answer was not awarded", () => {
    const shown = reconcileFindingsWithMarks({ ...base, marking: marking(false), awardedMarks: 1 });
    expect(shown.map((e) => e.errorId)).toEqual(["err_0", "err_1"]);
  });

  it("keeps findings when there is no criterion breakdown to contradict them", () => {
    expect(reconcileFindingsWithMarks({ ...base, marking: undefined, awardedMarks: 1 })).toHaveLength(2);
  });

  it("does nothing for a question with no findings", () => {
    expect(reconcileFindingsWithMarks({ ...base, explanations: [], marking: marking(true), awardedMarks: 3 })).toEqual([]);
  });
});
