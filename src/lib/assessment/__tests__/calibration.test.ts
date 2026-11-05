import { describe, expect, it, vi } from "vitest";

// The module also holds the database loader; only its pure functions are tested here.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { calibrationVerdict, summarizeAgreement, type MarkPair } from "@/lib/assessment/calibration";

const pairs = (list: Array<[number, number]>): MarkPair[] => list.map(([ai, teacher]) => ({ ai, teacher }));

describe("summarizeAgreement", () => {
  it("counts exact matches, matches within a mark, and changes", () => {
    const stats = summarizeAgreement(pairs([[3, 3], [4, 3], [2, 3.5], [1, 4]]));
    expect(stats).toMatchObject({ answers: 4, exact: 1, withinOne: 2, changed: 3 });
  });

  it("the average difference is teacher minus AI: positive means the AI was harsher", () => {
    expect(summarizeAgreement(pairs([[2, 3], [3, 4]])).averageDifference).toBe(1);
    expect(summarizeAgreement(pairs([[4, 3], [3, 2]])).averageDifference).toBe(-1);
  });

  it("is all zero for no answers", () => {
    expect(summarizeAgreement([])).toEqual({ answers: 0, exact: 0, withinOne: 0, changed: 0, averageDifference: 0 });
  });

  it("half marks are compared without floating-point surprises", () => {
    expect(summarizeAgreement(pairs([[0.1 + 0.2, 0.3]])).exact).toBe(1);
  });
});

describe("calibrationVerdict", () => {
  const agreeing = (n: number, bad = 0): MarkPair[] =>
    pairs([...Array.from({ length: n - bad }, (): [number, number] => [3, 3]), ...Array.from({ length: bad }, (): [number, number] => [1, 4])]);

  it("says it is too early until enough answers are reviewed", () => {
    const verdict = calibrationVerdict(summarizeAgreement(agreeing(6)));
    expect(verdict.status).toBe("TOO_FEW");
    expect(verdict.message).toMatch(/6 of the first 10/);
  });

  it("agrees when enough answers match within a mark", () => {
    const verdict = calibrationVerdict(summarizeAgreement(agreeing(10, 1)));
    expect(verdict.status).toBe("AGREES");
    expect(verdict.message).toMatch(/9 of 10 answers \(90%\)/);
  });

  it("is below the bar, with advice, when too few match", () => {
    const verdict = calibrationVerdict(summarizeAgreement(agreeing(10, 4)));
    expect(verdict.status).toBe("BELOW_BAR");
    expect(verdict.message).toMatch(/6 of 10 answers \(60%\).*below the 80% line.*marking it yourself/);
  });

  it("says which way the AI leans when it consistently differs", () => {
    const harsh = calibrationVerdict(summarizeAgreement(pairs(Array.from({ length: 10 }, (): [number, number] => [2, 3]))));
    expect(harsh.message).toMatch(/AI marked lower than you/);
    const generous = calibrationVerdict(summarizeAgreement(pairs(Array.from({ length: 10 }, (): [number, number] => [4, 3]))));
    expect(generous.message).toMatch(/AI marked higher than you/);
  });

  it("the bar and the minimum are the school's to set", () => {
    const stats = summarizeAgreement(agreeing(10, 2));
    expect(calibrationVerdict(stats, { bar: 0.9 }).status).toBe("BELOW_BAR");
    expect(calibrationVerdict(stats, { bar: 0.7 }).status).toBe("AGREES");
    expect(calibrationVerdict(stats, { minAnswers: 20 }).status).toBe("TOO_FEW");
  });

  it("exactly on the bar counts as agreeing", () => {
    expect(calibrationVerdict(summarizeAgreement(agreeing(10, 2))).status).toBe("AGREES"); // 8 of 10 = 80%
  });
});
