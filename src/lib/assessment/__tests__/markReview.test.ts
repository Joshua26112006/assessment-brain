import { describe, expect, it } from "vitest";
import {
  classifyAnswer,
  compareForReview,
  confirmationBlockers,
  roundMarks,
  validateTeacherMark,
  type AttentionInput,
} from "@/lib/assessment/markReview";

const grading = (extra: Record<string, unknown> = {}) => ({
  stage: "GRADING",
  contractVersion: "1",
  generatedAt: "2026-11-04T10:00:00Z",
  warnings: [],
  awardedMarks: 3,
  maximumMarks: 4,
  outcome: "FINAL",
  evidenceSource: "AI_VERIFIED",
  ...extra,
});

const sure = (overrides: Partial<AttentionInput> = {}): AttentionInput => ({
  responseStatus: "GRADED",
  gradingResult: grading(),
  reading: { agreementConfidence: "high", structureConfidence: "high" },
  mappingUncertain: false,
  openReviewReasons: [],
  ...overrides,
});

describe("classifyAnswer", () => {
  it("is sure only for a final mark, a confident reading and nothing flagged", () => {
    expect(classifyAnswer(sure())).toEqual({ level: "SURE", reasons: [], needsMark: false, reviewed: false });
  });

  it("treats an answer with no usable mark as one the teacher must mark", () => {
    for (const status of ["PENDING", "CORRECTING", "FAILED", "NEEDS_REVIEW", "GRADING"]) {
      const result = classifyAnswer(sure({ responseStatus: status }));
      expect(result.level, status).toBe("CANNOT_READ");
      expect(result.needsMark, status).toBe(true);
      expect(result.reviewed, status).toBe(false);
    }
  });

  it("treats a GRADED response whose stored result is not a final mark as needing a mark", () => {
    expect(classifyAnswer(sure({ gradingResult: null })).needsMark).toBe(true);
    expect(classifyAnswer(sure({ gradingResult: grading({ outcome: "NEEDS_REVIEW" }) })).needsMark).toBe(true);
    expect(classifyAnswer(sure({ gradingResult: { awardedMarks: "3" } })).needsMark).toBe(true);
  });

  it("explains why when a flag is open against an answer with no mark", () => {
    const result = classifyAnswer(sure({ responseStatus: "FAILED", openReviewReasons: ["UNDETERMINED_GRADING"] }));
    expect(result.reasons).toEqual(["No mark could be produced for this answer."]);
  });

  it("is unsure when a review item is open, even with a mark", () => {
    const result = classifyAnswer(sure({ openReviewReasons: ["NOVEL_APPROACH"] }));
    expect(result.level).toBe("UNSURE");
    expect(result.needsMark).toBe(false);
    expect(result.reasons[0]).toMatch(/method/);
  });

  it.each([
    [{ agreementConfidence: "medium", structureConfidence: "high" }],
    [{ agreementConfidence: "high", structureConfidence: "low" }],
    [{ agreementConfidence: undefined, structureConfidence: "high" }],
  ])("is unsure when the reading was not confident (%j)", (reading) => {
    const result = classifyAnswer(sure({ reading }));
    expect(result.level).toBe("UNSURE");
    expect(result.reasons[0]).toMatch(/handwriting/);
  });

  it("is unsure when the mapping stage was not sure which question this is", () => {
    const result = classifyAnswer(sure({ mappingUncertain: true }));
    expect(result.level).toBe("UNSURE");
    expect(result.reasons).toHaveLength(1);
  });

  it("does not repeat a reason", () => {
    const result = classifyAnswer(sure({ openReviewReasons: ["AMBIGUOUS_EXTRACTION", "AMBIGUOUS_EXTRACTION"] }));
    expect(result.reasons).toHaveLength(1);
  });

  it("does not need a reading when the response has none (older pipeline)", () => {
    expect(classifyAnswer(sure({ reading: null })).level).toBe("SURE");
  });

  it("reports an answer a teacher has already reviewed as reviewed", () => {
    const reviewed = classifyAnswer(sure({ gradingResult: grading({ teacherReview: { action: "CONFIRMED" } }) }));
    expect(reviewed.reviewed).toBe(true);
  });

  it("uses a generic reason for a review reason it does not know", () => {
    const result = classifyAnswer(sure({ openReviewReasons: ["SOMETHING_NEW"] }));
    expect(result.reasons).toEqual(["This answer was flagged for a teacher."]);
  });
});

describe("validateTeacherMark", () => {
  it.each([0, 0.5, 1, 1.5, 3.5, 4])("accepts %d out of 4", (marks) => {
    expect(validateTeacherMark(marks, 4)).toEqual({ ok: true, marks });
  });

  it.each([1.4, 0.25, 3.75, 0.1 + 0.2])("rejects %d: marks move in steps of 0.5", (marks) => {
    const result = validateTeacherMark(marks, 4);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringMatching(/0\.5/) });
  });

  it("rejects negative and above-maximum marks", () => {
    expect(validateTeacherMark(-0.5, 4)).toMatchObject({ ok: false, message: expect.stringMatching(/negative/) });
    expect(validateTeacherMark(4.5, 4)).toMatchObject({ ok: false, message: expect.stringMatching(/maximum of 4/) });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined, {}])("rejects %j as not a number", (raw) => {
    expect(validateTeacherMark(raw, 4)).toMatchObject({ ok: false, message: expect.stringMatching(/valid number/) });
  });

  it("accepts a half-mark maximum", () => {
    expect(validateTeacherMark(2.5, 2.5)).toEqual({ ok: true, marks: 2.5 });
  });
});

describe("confirmationBlockers", () => {
  const answer = (questionNumber: number, over: Partial<{ needsMark: boolean; reviewed: boolean; notAnswered: boolean }> = {}) => ({
    questionNumber,
    needsMark: false,
    reviewed: true,
    notAnswered: false,
    ...over,
  });

  it("has none when every answer is reviewed", () => {
    expect(confirmationBlockers([answer(1), answer(2)])).toEqual([]);
  });

  it("names each answer with no mark and each not yet checked, in question order", () => {
    const blockers = confirmationBlockers([
      answer(3, { reviewed: false }),
      answer(1, { needsMark: true, reviewed: false }),
      answer(2),
    ]);
    expect(blockers).toEqual([
      "Question 1 has no mark yet — enter one.",
      "Question 3 has not been checked yet.",
    ]);
  });

  it("names a question the way the paper does, not by its internal number", () => {
    const blockers = confirmationBlockers([
      { questionNumber: 6, label: "4", needsMark: true, reviewed: false, notAnswered: false },
      { questionNumber: 1, label: "1(a)", needsMark: false, reviewed: false, notAnswered: false },
    ]);
    expect(blockers).toEqual(["Question 1(a) has not been checked yet.", "Question 4 has no mark yet — enter one."]);
  });

  it("does not block on a question the student never answered", () => {
    expect(confirmationBlockers([answer(1), answer(2, { notAnswered: true, reviewed: false })])).toEqual([]);
  });

  it("has none for a paper with no questions", () => {
    expect(confirmationBlockers([])).toEqual([]);
  });
});

describe("roundMarks", () => {
  it("removes floating-point noise", () => {
    expect(roundMarks(0.1 + 0.2)).toBe(0.3);
    expect(roundMarks(2.5)).toBe(2.5);
  });
});

describe("compareForReview", () => {
  const entry = (questionNumber: number, level: "CANNOT_READ" | "UNSURE" | "SURE", answered = true) => ({ questionNumber, level, answered });

  it("puts answers with no mark first, then unsure ones, then sure ones, then unanswered", () => {
    const sorted = [entry(1, "SURE"), entry(2, "UNSURE"), entry(3, "CANNOT_READ"), entry(4, "SURE", false), entry(5, "SURE")].sort(compareForReview);
    expect(sorted.map((e) => e.questionNumber)).toEqual([3, 2, 1, 5, 4]);
  });

  it("keeps question order within a group", () => {
    const sorted = [entry(4, "UNSURE"), entry(2, "UNSURE"), entry(3, "UNSURE")].sort(compareForReview);
    expect(sorted.map((e) => e.questionNumber)).toEqual([2, 3, 4]);
  });
});

