import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/callStructured", () => ({ callStructuredAi: vi.fn() }));

import { callStructuredAi } from "@/lib/ai/callStructured";
import { decideWithoutModel, hasWorking, scoreByCriteria, type CriterionScoringInput } from "@/lib/structuredCorrection/criterionScoring";
import { parseNumericExpression } from "@/lib/structuredCorrection/numericExpression";
import { splitQuantity } from "@/lib/structuredCorrection/units";
import { DEFAULT_FOLLOW_THROUGH, DEFAULT_NO_WORKING_RULE, type Scheme, type SchemeCriterion } from "@/lib/scheme/criteria";
import type { ExtractedValue, ReconciledReading, StructuredExpectation } from "@/types/structuredCorrection";

const model = vi.mocked(callStructuredAi);

const value = (raw: string): ExtractedValue => {
  const unit = splitQuantity(raw).unitText;
  return { raw, parsed: parseNumericExpression(raw), ...(unit ? { unit } : {}) };
};

const c = (id: string, kind: SchemeCriterion["kind"], marks: number, description = `criterion ${id}`, extra: Partial<SchemeCriterion> = {}): SchemeCriterion => ({
  id,
  kind,
  description,
  marks,
  ...extra,
});

function reading(over: Partial<ReconciledReading> = {}): ReconciledReading {
  return {
    questionNumber: 1,
    transcription: "W = F x d\nW = 2 x 10 x 5 = 100 J",
    attempted: true,
    agreementConfidence: "high",
    problemType: "unknown",
    steps: ["formula", "substitute", "answer"],
    variables: {},
    studentAnswer: value("100 J"),
    structureConfidence: "high",
    secondPass: { variables: {}, studentAnswer: value("100 J") },
    ...over,
  };
}

const expectation = (answer: string): StructuredExpectation => ({ solvable: true, problemType: "unknown", correctAnswer: value(answer), approaches: [] });

const scheme = (criteria: SchemeCriterion[], over: Partial<Scheme> = {}): Scheme => ({
  criteria,
  followThrough: DEFAULT_FOLLOW_THROUGH,
  noWorkingRule: DEFAULT_NO_WORKING_RULE,
  acceptedAlternatives: [],
  ...over,
});

function input(over: Partial<CriterionScoringInput> = {}): CriterionScoringInput {
  return {
    questionText: "Find the work done.",
    maximumMarks: 4,
    subject: "Physics",
    expectedAnswer: "100 J",
    partialCreditGuidance: null,
    scheme: scheme([c("c1", "STEP", 1, "Writes W = F x d"), c("c2", "VALUE", 1, "Substitutes 2, 10, 5"), c("c3", "FINAL_ANSWER", 1.5), c("c4", "UNIT", 0.5, "unit", { unit: "J" })]),
    structuredExpectation: expectation("100 J"),
    comparison: null,
    reading: reading(),
    ...over,
  };
}

/** A model reply saying yes with a real quote for each id asked about. */
const allYes = (ids: string[], evidence = "W = F x d") => ({ criteria: ids.map((id) => ({ id, met: "yes", evidence })), feedback: "Well done." });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decideWithoutModel — what code settles on its own", () => {
  it("settles the final answer and the unit, and leaves the method steps to the model", () => {
    const decided = decideWithoutModel(input());
    expect(decided.outcomes.map((o) => [o.criterionId, o.met])).toEqual([["c3", "yes"], ["c4", "yes"]]);
    expect(decided.askModel.map((x) => x.id)).toEqual(["c1", "c2"]);
    expect(decided.finalAnswerCorrect).toBe(true);
  });

  it("a wrong final answer is 'no' for the final-answer criterion, decided by code", () => {
    const decided = decideWithoutModel(input({ reading: reading({ studentAnswer: value("120 J"), secondPass: { variables: {}, studentAnswer: value("120 J") } }) }));
    expect(decided.outcomes.find((o) => o.criterionId === "c3")?.met).toBe("no");
    expect(decided.finalAnswerCorrect).toBe(false);
  });

  it("2000 mg for a key of 2 g is a correct final answer, but its unit is not the key's unit", () => {
    const decided = decideWithoutModel(
      input({
        structuredExpectation: expectation("2 g"),
        scheme: scheme([c("c1", "FINAL_ANSWER", 3), c("c2", "UNIT", 1, "unit", { unit: "g" })]),
        reading: reading({ studentAnswer: value("2000 mg"), secondPass: { variables: {}, studentAnswer: value("2000 mg") } }),
      }),
    );
    expect(decided.outcomes.find((o) => o.criterionId === "c1")?.met).toBe("yes");
    expect(decided.outcomes.find((o) => o.criterionId === "c2")?.met).toBe("no");
  });

  it("a missing unit is 'no' for the unit criterion when the reading is confident", () => {
    const decided = decideWithoutModel(input({ reading: reading({ studentAnswer: value("100"), secondPass: { variables: {}, studentAnswer: value("100") } }) }));
    expect(decided.outcomes.find((o) => o.criterionId === "c4")?.met).toBe("no");
  });

  it("does NOT decide a unit from a doubtful reading: it asks the model and flags the teacher", () => {
    const decided = decideWithoutModel(input({ reading: reading({ agreementConfidence: "medium" }) }));
    expect(decided.outcomes.some((o) => o.criterionId === "c4")).toBe(false);
    expect(decided.askModel.map((x) => x.id)).toContain("c4");
  });

  it("leaves the final answer to the model when the key is not numeric, and says the teacher should know", () => {
    const decided = decideWithoutModel(input({ structuredExpectation: null }));
    expect(decided.finalAnswerCorrect).toBeNull();
    expect(decided.askModel.map((x) => x.id)).toContain("c3");
    expect(decided.undecidedFinalAnswer).toBe(false);
  });

  it("flags an undecidable final answer when the key IS numeric but the two reading passes disagreed", () => {
    const decided = decideWithoutModel(input({ reading: reading({ secondPass: { variables: {}, studentAnswer: value("10 J") } }) }));
    expect(decided.finalAnswerCorrect).toBeNull();
    expect(decided.undecidedFinalAnswer).toBe(true);
  });

  it("an exact-answer criterion is decided by code only when it is sure", () => {
    const exact = scheme([c("c1", "EXACT_KEY", 1, "capital", { accepted: ["Paris"] })]);
    const sure = decideWithoutModel(input({ scheme: exact, reading: reading({ studentAnswer: value("Paris") }) }));
    expect(sure.outcomes[0].met).toBe("yes");
    const close = decideWithoutModel(input({ scheme: exact, reading: reading({ studentAnswer: value("Pariss") }) }));
    expect(close.outcomes).toEqual([]);
    expect(close.askModel).toHaveLength(1);
  });
});

describe("hasWorking", () => {
  it("is false when only the answer was written", () => {
    expect(hasWorking(reading({ transcription: "100 J", steps: [], studentAnswer: value("100 J") }))).toBe(false);
    expect(hasWorking(reading({ transcription: "Ans: 100 J", steps: ["answer"], studentAnswer: value("100 J") }))).toBe(false);
  });

  it("is true when there is any working", () => {
    expect(hasWorking(reading())).toBe(true);
    expect(hasWorking(reading({ transcription: "W = F x d\nAns: 100 J", steps: ["formula"], studentAnswer: value("100 J") }))).toBe(true);
  });
});

describe("scoreByCriteria", () => {
  it("does not call a model for an unattempted question", async () => {
    const score = await scoreByCriteria(input({ reading: reading({ attempted: false, transcription: "" }) }));
    expect(score.awardedMarks).toBe(0);
    expect(model).not.toHaveBeenCalled();
  });

  it("marks a fully correct answer 4/4, summed by code, with three runs and no flags", async () => {
    model.mockResolvedValue(allYes(["c1", "c2"]));
    const score = await scoreByCriteria(input());
    expect(model).toHaveBeenCalledTimes(3);
    expect(score.awardedMarks).toBe(4);
    expect(score.marking?.runTotals).toEqual([4, 4, 4]);
    expect(score.marking?.unsure).toBe(false);
    expect(score.marking?.criteria.map((x) => x.awarded)).toEqual([1, 1, 1.5, 0.5]);
  });

  it("the model never supplies a total: a reply with only a total and no criteria is not a usable mark", async () => {
    model.mockResolvedValue({ awardedMarks: 4, feedback: "x" });
    await expect(scoreByCriteria(input())).rejects.toThrow(/did not return a usable/);
  });

  it("takes the MEDIAN of three runs: 4, 4, 3 is 4", async () => {
    const replies = [
      allYes(["c1", "c2"]),
      allYes(["c1", "c2"]),
      { criteria: [{ id: "c1", met: "yes", evidence: "W = F x d" }, { id: "c2", met: "no" }], feedback: "" },
    ];
    model.mockImplementation(async () => replies.shift());
    const score = await scoreByCriteria(input());
    expect(score.marking?.runTotals.slice().sort()).toEqual([3, 4, 4]);
    expect(score.awardedMarks).toBe(4);
    expect(score.marking?.spread).toBe(1);
    // A spread of exactly one mark on a 4-mark question is within the rule: steady enough.
    expect(score.marking?.unsure).toBe(false);
  });

  it("flags runs that disagree by more than a mark for the teacher, and still gives the median", async () => {
    const replies = [
      allYes(["c1", "c2"]),
      { criteria: [{ id: "c1", met: "no" }, { id: "c2", met: "no" }], feedback: "" },
      { criteria: [{ id: "c1", met: "no" }, { id: "c2", met: "no" }], feedback: "" },
    ];
    model.mockImplementation(async () => replies.shift());
    const score = await scoreByCriteria(input());
    expect(score.awardedMarks).toBe(2);
    expect(score.marking?.unsure).toBe(true);
    expect(score.marking?.reasons[0]).toMatch(/disagreed/);
  });

  it("lists the criteria in a different order in each of the three runs", async () => {
    model.mockResolvedValue(allYes(["c1", "c2"]));
    await scoreByCriteria(input());
    const orders = model.mock.calls.map(([options]) => (options.userPrompt.match(/- id (c\d)/g) ?? []).join(","));
    expect(new Set(orders).size).toBe(2); // two criteria go to the model, so there are two distinct orders across three runs
    expect(orders[0]).not.toBe(orders[1]);
  });

  it("tells the model what code already decided, and asks only about the rest", async () => {
    model.mockResolvedValue(allYes(["c1", "c2"]));
    await scoreByCriteria(input());
    const prompt = model.mock.calls[0][0].userPrompt;
    expect(prompt).toContain("ALREADY ESTABLISHED");
    expect(prompt).toMatch(/final answer.*is correct/);
    expect(prompt).not.toMatch(/- id c3/);
    expect(prompt).not.toMatch(/- id c4/);
  });

  it("when code decides everything, it uses no model and one run", async () => {
    const onlyCode = input({ scheme: scheme([c("c1", "FINAL_ANSWER", 3.5), c("c2", "UNIT", 0.5, "unit", { unit: "J" })]) });
    const score = await scoreByCriteria(onlyCode);
    expect(model).not.toHaveBeenCalled();
    expect(score.awardedMarks).toBe(4);
    expect(score.marking?.runTotals).toEqual([4]);
  });

  it("a correct answer with no working earns only the answer's marks and is flagged (D6)", async () => {
    model.mockResolvedValue(allYes(["c1", "c2"]));
    const score = await scoreByCriteria(input({ reading: reading({ transcription: "100 J", steps: [], studentAnswer: value("100 J") }) }));
    expect(score.awardedMarks).toBe(2); // 1.5 + 0.5
    expect(score.marking?.unsure).toBe(true);
    expect(score.marking?.reasons.join(" ")).toMatch(/no working was shown/);
  });

  it("flags credit given without a matching quote from the transcription", async () => {
    model.mockResolvedValue({ criteria: [{ id: "c1", met: "yes", evidence: "v = u + at" }, { id: "c2", met: "yes", evidence: "2 x 10 x 5" }], feedback: "" });
    const score = await scoreByCriteria(input());
    expect(score.marking?.unsure).toBe(true);
    expect(score.marking?.reasons.join(" ")).toMatch(/without a matching line/);
  });

  it("a criterion the model skipped earns nothing and is flagged, never assumed", async () => {
    model.mockResolvedValue({ criteria: [{ id: "c1", met: "yes", evidence: "W = F x d" }], feedback: "" });
    const score = await scoreByCriteria(input());
    expect(score.awardedMarks).toBe(3); // c1 1 + c3 1.5 + c4 0.5
    expect(score.marking?.reasons.join(" ")).toMatch(/did not give a result for every part/);
  });

  it("follow-through: an earlier error carried forward is honoured or not, from the scheme, never by the model", async () => {
    const carried = { criteria: [{ id: "c1", met: "yes", evidence: "W = F x d" }, { id: "c2", met: "yes", evidence: "2 x 10 x 5", usesEarlierError: true }], feedback: "" };
    model.mockResolvedValue(carried);
    const allowed = await scoreByCriteria(input({ scheme: scheme(input().scheme.criteria, { followThrough: "ALLOWED" }) }));
    const refused = await scoreByCriteria(input({ scheme: scheme(input().scheme.criteria, { followThrough: "NOT_ALLOWED" }) }));
    expect(allowed.awardedMarks).toBe(4);
    expect(refused.awardedMarks).toBe(3);
  });

  it("survives one failed run: uses the other two, and says so", async () => {
    let calls = 0;
    model.mockImplementation(async () => {
      calls++;
      if (calls === 2) throw new Error("provider hiccup");
      return allYes(["c1", "c2"]);
    });
    const score = await scoreByCriteria(input());
    expect(score.awardedMarks).toBe(4);
    expect(score.marking?.runTotals).toHaveLength(2);
    expect(score.marking?.reasons.join(" ")).toMatch(/Only 2 of 3/);
  });

  it("fails (never a silent zero) when every run fails", async () => {
    model.mockRejectedValue(new Error("down"));
    await expect(scoreByCriteria(input())).rejects.toThrow(/did not return a usable mark/);
  });

  it("asks again when a reply answers nothing, then gives up", async () => {
    model.mockResolvedValue({ criteria: [] });
    await expect(scoreByCriteria(input())).rejects.toThrow();
    // 3 runs, each tries twice
    expect(model).toHaveBeenCalledTimes(6);
  });

  it("never exceeds the question's marks, whatever the model says", async () => {
    model.mockResolvedValue(allYes(["c1", "c2", "c3", "c4", "c99"]));
    const score = await scoreByCriteria(input());
    expect(score.awardedMarks).toBeLessThanOrEqual(4);
  });
});
