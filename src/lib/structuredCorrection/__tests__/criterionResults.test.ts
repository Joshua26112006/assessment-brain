import { describe, expect, it } from "vitest";
import {
  describeAwards,
  markingReasons,
  medianOf,
  parseCriterionReply,
  runsDisagree,
  spreadOf,
} from "@/lib/structuredCorrection/criterionResults";

const TRANSCRIPT = "W = F x d\nW = 2 x 10 x 5 = 120 J";

describe("parseCriterionReply", () => {
  it("reads yes, no and partial for the criteria asked about", () => {
    const reply = parseCriterionReply(
      { criteria: [{ id: "c1", met: "yes", evidence: "W = F x d" }, { id: "c2", met: "no" }, { id: "c3", met: "partial", evidence: "= 120 J" }], feedback: " Good. " },
      ["c1", "c2", "c3"],
      TRANSCRIPT,
    );
    expect(reply.outcomes.map((o) => [o.criterionId, o.met])).toEqual([["c1", "yes"], ["c2", "no"], ["c3", "partial"]]);
    expect(reply.missing).toEqual([]);
    expect(reply.feedback).toBe("Good.");
  });

  it("accepts true and false, and text such as 'Met'", () => {
    const reply = parseCriterionReply({ criteria: [{ id: "a", met: true, evidence: "W = F x d" }, { id: "b", met: false }, { id: "c", met: "Met", evidence: "120 J" }] }, ["a", "b", "c"], TRANSCRIPT);
    expect(reply.outcomes.map((o) => o.met)).toEqual(["yes", "no", "yes"]);
  });

  it("reports a criterion the model did not answer, or answered with nonsense, as missing: never assumed yes or no", () => {
    const reply = parseCriterionReply({ criteria: [{ id: "c1", met: "maybe" }, { id: "c3", met: "no" }] }, ["c1", "c2", "c3"], TRANSCRIPT);
    expect(reply.missing).toEqual(["c1", "c2"]);
  });

  it("ignores a criterion that was not asked about and a repeated one", () => {
    const reply = parseCriterionReply(
      { criteria: [{ id: "ghost", met: "yes" }, { id: "c1", met: "no" }, { id: "c1", met: "yes", evidence: "120 J" }] },
      ["c1"],
      TRANSCRIPT,
    );
    expect(reply.outcomes).toEqual([{ criterionId: "c1", met: "no" }]);
  });

  it("flags credit whose evidence is not in the transcription, or has none", () => {
    const reply = parseCriterionReply(
      { criteria: [{ id: "a", met: "yes", evidence: "v = u + at" }, { id: "b", met: "yes" }, { id: "c", met: "yes", evidence: "w = f x d" }] },
      ["a", "b", "c"],
      TRANSCRIPT,
    );
    expect(reply.evidenceNotFound).toEqual(["a", "b"]);
  });

  it("does not ask for evidence for a criterion that earned nothing", () => {
    expect(parseCriterionReply({ criteria: [{ id: "a", met: "no" }] }, ["a"], TRANSCRIPT).evidenceNotFound).toEqual([]);
  });

  it("carries usesEarlierError only when it is exactly true", () => {
    const reply = parseCriterionReply(
      { criteria: [{ id: "a", met: "yes", evidence: "120 J", usesEarlierError: true }, { id: "b", met: "yes", evidence: "120 J", usesEarlierError: "yes" }] },
      ["a", "b"],
      TRANSCRIPT,
    );
    expect(reply.outcomes[0].usesEarlierError).toBe(true);
    expect(reply.outcomes[1].usesEarlierError).toBeUndefined();
  });

  it.each([null, undefined, "x", 3, [], {}, { criteria: "no" }])("a reply of %j answers nothing", (raw) => {
    expect(parseCriterionReply(raw, ["c1"], TRANSCRIPT)).toMatchObject({ outcomes: [], missing: ["c1"] });
  });
});

describe("medianOf and spreadOf", () => {
  it("is the middle of three", () => {
    expect(medianOf([4, 4, 3])).toBe(4);
    expect(medianOf([3, 4, 2])).toBe(3);
    expect(medianOf([2, 2, 2])).toBe(2);
  });

  it("with two runs takes the lower, cautiously", () => {
    expect(medianOf([3, 4])).toBe(3);
  });

  it("with one run is that run", () => {
    expect(medianOf([3.5])).toBe(3.5);
  });

  it("refuses an empty list", () => {
    expect(() => medianOf([])).toThrow();
  });

  it("spread is the range", () => {
    expect(spreadOf([4, 3, 3.5])).toBe(1);
    expect(spreadOf([2])).toBe(0);
  });
});

describe("runsDisagree (D2: more than 1 mark, or more than 25% of the question)", () => {
  it("steady runs do not disagree", () => {
    expect(runsDisagree([4, 4, 4], 5)).toBe(false);
    expect(runsDisagree([3, 3.5, 3], 10)).toBe(false);
  });

  it("a spread above one mark disagrees", () => {
    expect(runsDisagree([4, 2.5, 3], 20)).toBe(true);
  });

  it("a spread above 25% of a small question disagrees even when it is one mark or less", () => {
    expect(runsDisagree([1, 0.5], 1)).toBe(true); // 0.5 of 1 mark is 50%
    expect(runsDisagree([3, 4], 4)).toBe(false); // exactly 1 mark and exactly 25%: not above either
    expect(runsDisagree([2, 3], 3)).toBe(true); // 1 mark is 33%
  });

  it("one run cannot disagree with itself", () => {
    expect(runsDisagree([3], 4)).toBe(false);
  });

  it("the Phase 4 baseline 4,4,3,3,4 over four marks is within the rule only because it is one mark", () => {
    expect(runsDisagree([4, 3, 4], 4)).toBe(false);
    expect(runsDisagree([4, 3, 4, 3, 4], 4)).toBe(false);
  });
});

describe("markingReasons", () => {
  const base = { totals: [3, 3, 3], maximumMarks: 4, runsAttempted: 3, flags: [], readingConfident: true, evidenceNotFoundCount: 0, undecidedFinalAnswer: false };

  it("says nothing when the marking is steady and confident", () => {
    expect(markingReasons(base)).toEqual([]);
  });

  it("explains each cause in plain words", () => {
    expect(markingReasons({ ...base, totals: [4, 2, 3] })[0]).toMatch(/disagreed.*2 to 4 out of 4/);
    expect(markingReasons({ ...base, totals: [3, 3], runsAttempted: 3 }).join(" ")).toMatch(/Only 2 of 3/);
    expect(markingReasons({ ...base, flags: ["NO_WORKING"] }).join(" ")).toMatch(/no working was shown/);
    expect(markingReasons({ ...base, flags: ["FINAL_ANSWER_CORRECT_NOT_FULL"] }).join(" ")).toMatch(/correct but full marks were not given/);
    expect(markingReasons({ ...base, flags: ["UNKNOWN_CRITERION"] }).join(" ")).toMatch(/did not give a result/);
    expect(markingReasons({ ...base, evidenceNotFoundCount: 1 }).join(" ")).toMatch(/without a matching line/);
    expect(markingReasons({ ...base, readingConfident: false }).join(" ")).toMatch(/handwriting/);
    expect(markingReasons({ ...base, undecidedFinalAnswer: true }).join(" ")).toMatch(/could not be checked automatically/);
  });

  it("does not say 'full marks not given' twice when the no-working rule already explains it", () => {
    const text = markingReasons({ ...base, flags: ["NO_WORKING", "FINAL_ANSWER_CORRECT_NOT_FULL"] }).join(" ");
    expect(text).not.toMatch(/Check why/);
  });
});

describe("describeAwards", () => {
  it("lists every criterion with what it earned and the evidence", () => {
    const criteria = [
      { id: "c1", kind: "STEP" as const, description: "Formula", marks: 1 },
      { id: "c2", kind: "FINAL_ANSWER" as const, description: "Answer", marks: 2 },
    ];
    const result = describeAwards(
      criteria,
      [{ criterionId: "c1", maxMarks: 1, awarded: 1 }, { criterionId: "c2", maxMarks: 2, awarded: 0, note: "wrong" }],
      [{ criterionId: "c1", met: "yes", evidence: "W = F x d" }],
    );
    expect(result).toEqual([
      { id: "c1", kind: "STEP", description: "Formula", maxMarks: 1, awarded: 1, evidence: "W = F x d" },
      { id: "c2", kind: "FINAL_ANSWER", description: "Answer", maxMarks: 2, awarded: 0, note: "wrong" },
    ]);
  });
});
