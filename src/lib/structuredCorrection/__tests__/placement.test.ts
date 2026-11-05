import { describe, expect, it } from "vitest";
import { describePlacement, summarizePlacement, type PlacementQuestion } from "@/lib/structuredCorrection/annotation/placement";

const q = (questionNumber: number, over: Partial<PlacementQuestion> = {}): PlacementQuestion => ({
  questionNumber,
  sourcePages: [1],
  explanations: [],
  ...over,
});

describe("summarizePlacement", () => {
  it("reports nothing when every question was placed and every kept finding circled", () => {
    const summary = summarizePlacement(
      [q(1, { explanations: [{ errorId: "e0", wrongText: "120 J" }] }), q(2)],
      [{ placedQuestions: [1, 2], circled: [{ questionNumber: 1, errorId: "e0" }] }],
    );
    expect(summary).toEqual({ unplacedQuestions: [], unplacedFindings: [] });
  });

  it("names a question that was written on the pages but whose marker was never found", () => {
    const summary = summarizePlacement([q(1), q(3, { label: "2(b)" })], [{ placedQuestions: [1], circled: [] }]);
    expect(summary.unplacedQuestions).toEqual(["2(b)"]);
  });

  it("a question placed on any one page counts as placed", () => {
    const summary = summarizePlacement(
      [q(1, { sourcePages: [1, 2] })],
      [{ placedQuestions: [], circled: [] }, { placedQuestions: [1], circled: [] }],
    );
    expect(summary.unplacedQuestions).toEqual([]);
  });

  it("says nothing about a question whose pages are unknown", () => {
    expect(summarizePlacement([q(1, { sourcePages: [] })], [{ placedQuestions: [], circled: [] }]).unplacedQuestions).toEqual([]);
  });

  it("counts a kept finding that could not be circled, on a question that WAS placed", () => {
    const summary = summarizePlacement(
      [q(1, { explanations: [{ errorId: "e0", wrongText: "120 J" }, { errorId: "e1", wrongText: "5 m" }, { errorId: "e2" }] })],
      [{ placedQuestions: [1], circled: [{ questionNumber: 1, errorId: "e0" }] }],
    );
    // e1 was not circled; e2 has nothing written to circle (a missing step) so it is not counted.
    expect(summary.unplacedFindings).toEqual([{ question: "1", count: 1 }]);
  });

  it("does not report findings twice for a question that was not placed at all", () => {
    const summary = summarizePlacement([q(1, { explanations: [{ errorId: "e0", wrongText: "x" }] })], [{ placedQuestions: [], circled: [] }]);
    expect(summary.unplacedQuestions).toEqual(["1"]);
    expect(summary.unplacedFindings).toEqual([]);
  });
});

describe("describePlacement", () => {
  it("is empty when everything was placed", () => {
    expect(describePlacement({ unplacedQuestions: [], unplacedFindings: [] })).toEqual([]);
  });

  it("explains in plain words what is missing and that the marks still count", () => {
    const notes = describePlacement({ unplacedQuestions: ["2(b)", "4"], unplacedFindings: [{ question: "1", count: 1 }] });
    expect(notes[0]).toMatch(/questions 2\(b\), 4 could not be placed.*still in the total/);
    expect(notes[1]).toMatch(/1 mistake you kept on question 1 could not be circled/);
  });

  it("uses the singular for one question", () => {
    expect(describePlacement({ unplacedQuestions: ["3"], unplacedFindings: [] })[0]).toMatch(/question 3 could not be placed.*it is not drawn/);
  });
});
