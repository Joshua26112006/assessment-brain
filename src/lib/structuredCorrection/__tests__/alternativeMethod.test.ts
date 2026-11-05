import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredAi = vi.fn();
vi.mock("@/lib/ai/callStructured", () => ({ callStructuredAi: (...args: unknown[]) => callStructuredAi(...args) }));

import {
  checkAlternativeMethod,
  methodCheckReason,
  needsMethodCheck,
  parseMethodCheck,
} from "@/lib/structuredCorrection/alternativeMethod";
import { aiFeedbackMayReachStudent } from "@/lib/release";

describe("needsMethodCheck", () => {
  const base = { flags: ["FINAL_ANSWER_CORRECT_NOT_FULL"], hasWorking: true, awardedMarks: 2, maximumMarks: 4 };

  it("asks when the final answer is right, marks were lost, and there was working", () => {
    expect(needsMethodCheck(base)).toBe(true);
  });

  it("does not ask when full marks were given", () => {
    expect(needsMethodCheck({ ...base, awardedMarks: 4 })).toBe(false);
  });

  it("does not ask when the final answer was not right", () => {
    expect(needsMethodCheck({ ...base, flags: [] })).toBe(false);
    expect(needsMethodCheck({ ...base, flags: undefined })).toBe(false);
  });

  it("does not ask when no working was shown: there is no method to judge", () => {
    expect(needsMethodCheck({ ...base, hasWorking: false })).toBe(false);
    expect(needsMethodCheck({ ...base, flags: ["FINAL_ANSWER_CORRECT_NOT_FULL", "NO_WORKING"] })).toBe(false);
  });
});

describe("parseMethodCheck", () => {
  it("accepts a verdict with a reason, in any case", () => {
    expect(parseMethodCheck({ verdict: "Valid", reason: " Uses energy instead of kinematics. " })).toEqual({
      verdict: "valid",
      reason: "Uses energy instead of kinematics.",
    });
  });

  it("refuses anything else", () => {
    expect(parseMethodCheck(null)).toBeNull();
    expect(parseMethodCheck({ verdict: "maybe", reason: "x" })).toBeNull();
    expect(parseMethodCheck({ verdict: "valid", reason: "  " })).toBeNull();
    expect(parseMethodCheck({ verdict: "valid" })).toBeNull();
  });
});

describe("checkAlternativeMethod", () => {
  const input = {
    questionText: "Find v.",
    subject: "Physics",
    expectedAnswer: "v = 20 m/s",
    criteria: [{ description: "Uses v = u + at", marks: 2 }],
    transcription: "KE = mgh so v = 20",
  };

  beforeEach(() => {
    callStructuredAi.mockReset();
    callStructuredAi.mockImplementation(async () => ({}));
  });

  it("returns the opinion", async () => {
    callStructuredAi.mockResolvedValueOnce({ verdict: "valid", reason: "Energy method is correct." });
    expect(await checkAlternativeMethod(input)).toEqual({ verdict: "valid", reason: "Energy method is correct." });
  });

  it("asks again once after an unusable reply", async () => {
    callStructuredAi.mockResolvedValueOnce({ nonsense: true }).mockResolvedValueOnce({ verdict: "unclear", reason: "Too short." });
    expect((await checkAlternativeMethod(input))?.verdict).toBe("unclear");
    expect(callStructuredAi).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly when the model keeps failing: the mark must stand", async () => {
    callStructuredAi.mockImplementation(async () => {
      throw new Error("network");
    });
    expect(await checkAlternativeMethod(input)).toBeNull();
  });
});

describe("methodCheckReason", () => {
  it("always asks the teacher to check, whatever the verdict", () => {
    for (const verdict of ["valid", "invalid", "unclear"] as const) {
      expect(methodCheckReason({ verdict, reason: "r" })).toContain("Please check it before the mark is released.");
    }
  });
});

describe("aiFeedbackMayReachStudent", () => {
  it("allows the AI's feedback when the teacher accepted the mark", () => {
    expect(aiFeedbackMayReachStudent({ teacherReview: { action: "CONFIRMED" } })).toBe(true);
    expect(aiFeedbackMayReachStudent({})).toBe(true);
    expect(aiFeedbackMayReachStudent(null)).toBe(true);
  });

  it("withholds it once the teacher changed the mark", () => {
    expect(aiFeedbackMayReachStudent({ teacherReview: { action: "OVERRIDDEN" } })).toBe(false);
  });
});
