import { describe, expect, it } from "vitest";
import { rulesApply } from "@/lib/scheme/criteria";


describe("rulesApply", () => {
  it("applies to a calculation: working plus a final answer", () => {
    expect(rulesApply([{ kind: "STEP" }, { kind: "VALUE" }, { kind: "FINAL_ANSWER" }, { kind: "UNIT" }])).toBe(true);
  });

  it("does not apply to a descriptive answer, an essay or an exact answer", () => {
    expect(rulesApply([{ kind: "VALUE_POINT" }, { kind: "VALUE_POINT" }])).toBe(false);
    expect(rulesApply([{ kind: "LEVEL" }])).toBe(false);
    expect(rulesApply([{ kind: "EXACT_KEY" }])).toBe(false);
  });

  it("does not apply to a lone final answer: there is no working to follow", () => {
    expect(rulesApply([{ kind: "FINAL_ANSWER" }])).toBe(false);
  });
});
