import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { submission: { findUnique: vi.fn() } } }));
vi.mock("@/lib/handwritten/pages", () => ({ loadOrderedAnswerSheetPages: vi.fn() }));
vi.mock("@/lib/assessment/markRelease", () => ({ loadSubmissionReview: vi.fn() }));
vi.mock("@/lib/structuredCorrection/annotation", () => ({ annotateAnswerSheet: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { loadSubmissionReview, type ReviewAnswerRow } from "@/lib/assessment/markRelease";
import { annotateAnswerSheet } from "@/lib/structuredCorrection/annotation";
import { generateMarkedCopy } from "@/lib/assessment/markedCopy";

const findSubmission = vi.mocked(prisma.submission.findUnique);
const loadPages = vi.mocked(loadOrderedAnswerSheetPages);
const loadRows = vi.mocked(loadSubmissionReview);
const draw = vi.mocked(annotateAnswerSheet);

const PAGE = { pageId: "p1", pageNumber: 1, mimeType: "image/png", buffer: Buffer.from("png") };

function row(number: number, overrides: Partial<NonNullable<ReviewAnswerRow["response"]>> | null, maximumMarks = 4): ReviewAnswerRow {
  return {
    questionId: `q${number}`,
    questionNumber: number,
    label: String(number),
    questionText: `Question ${number}`,
    maximumMarks,
    response:
      overrides === null
        ? null
        : {
            id: `r${number}`,
            status: "GRADED",
            studentAnswerText: "x",
            gradingResult: null,
            annotationResult: null,
            correctionResult: null,
            awardedMarks: 3,
            sourcePages: [1],
            findings: [],
            marking: null,
            ...overrides,
          },
    attention: { level: "SURE", reasons: [], needsMark: false, reviewed: true },
  };
}

const finding = (id: string, kept: boolean, wrongText: string | null = "120 J") => ({
  id,
  type: "root_arithmetic_error" as const,
  explanation: `Finding ${id}`,
  wrongText,
  correctVersion: "100",
  kept,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  findSubmission.mockResolvedValue({ id: "sub1", assessmentId: "a1" } as never);
  loadPages.mockResolvedValue([PAGE]);
  draw.mockResolvedValue([{ pageNumber: 1, annotated: true, reason: null, placedQuestions: [1], circled: [] }]);
});

describe("generateMarkedCopy", () => {
  it("draws only the findings the teacher kept", async () => {
    loadRows.mockResolvedValue([row(1, { findings: [finding("err_0", true), finding("err_1", false), finding("err_2", true, null)] })]);

    await generateMarkedCopy("sub1");

    const [, questions] = draw.mock.calls[0];
    expect(questions[0].explanations.map((e) => e.errorId)).toEqual(["err_0", "err_2"]);
    expect(questions[0].explanations[0]).toMatchObject({ wrongText: "120 J", correctVersion: "100" });
    expect(questions[0].explanations[1].wrongText).toBeUndefined();
  });

  it("draws nothing when the teacher kept nothing — AI suggestions never reach the copy on their own", async () => {
    loadRows.mockResolvedValue([row(1, { findings: [finding("err_0", false), finding("err_1", false)] })]);
    await generateMarkedCopy("sub1");
    expect(draw.mock.calls[0][1][0].explanations).toEqual([]);
  });

  it("uses the marks the teacher settled on, not the AI's draft", async () => {
    // loadSubmissionReview reports the stored (teacher-final) mark.
    loadRows.mockResolvedValue([row(1, { awardedMarks: 1.5 }), row(2, { awardedMarks: 4 })]);
    await generateMarkedCopy("sub1");
    expect(draw.mock.calls[0][1].map((q) => [q.questionNumber, q.awardedMarks])).toEqual([[1, 1.5], [2, 4]]);
  });

  it("totals out of the whole paper, including questions the student did not answer", async () => {
    loadRows.mockResolvedValue([row(1, { awardedMarks: 3 }), row(2, { awardedMarks: 2 }), row(3, null)]);
    await generateMarkedCopy("sub1");
    expect(draw.mock.calls[0][2]).toEqual({ awarded: 5, maximum: 12 });
    expect(draw.mock.calls[0][1].map((q) => q.questionNumber)).toEqual([1, 2]);
  });

  it("treats a missing mark as 0 rather than failing", async () => {
    loadRows.mockResolvedValue([row(1, { awardedMarks: null })]);
    await generateMarkedCopy("sub1");
    expect(draw.mock.calls[0][1][0].awardedMarks).toBe(0);
  });

  it("passes the pages and where each answer was read from", async () => {
    loadRows.mockResolvedValue([row(1, { sourcePages: [1, 2] })]);
    await generateMarkedCopy("sub1");
    const [pages, questions] = draw.mock.calls[0];
    expect(pages).toEqual([{ pageId: "p1", pageNumber: 1, submissionId: "sub1", buffer: PAGE.buffer }]);
    expect(questions[0].sourcePages).toEqual([1, 2]);
  });

  it("reports how many pages were drawn", async () => {
    loadPages.mockResolvedValue([PAGE, { ...PAGE, pageId: "p2", pageNumber: 2 }]);
    loadRows.mockResolvedValue([row(1, {})]);
    draw.mockResolvedValue([
      { pageNumber: 1, annotated: true, reason: null, placedQuestions: [1], circled: [] },
      { pageNumber: 2, annotated: false, reason: "This page could not be annotated.", placedQuestions: [], circled: [] },
    ]);
    expect(await generateMarkedCopy("sub1")).toEqual({ ok: true, annotatedPages: 1, failedPages: 1, reason: null, notes: [] });
  });

  it("tells the teacher which questions and kept mistakes could not be placed, instead of leaving them out silently", async () => {
    loadRows.mockResolvedValue([
      row(1, { sourcePages: [1], findings: [finding("err_0", true, "120 J")] }),
      row(2, { sourcePages: [1] }),
    ]);
    // Question 1's marker was found but its wrong value could not be circled; question 2's marker was not found at all.
    draw.mockResolvedValue([{ pageNumber: 1, annotated: true, reason: null, placedQuestions: [1], circled: [] }]);

    const outcome = await generateMarkedCopy("sub1");

    expect(outcome.ok).toBe(true);
    expect(outcome.notes).toHaveLength(2);
    expect(outcome.notes[0]).toMatch(/question 2 could not be placed/);
    expect(outcome.notes[1]).toMatch(/1 mistake you kept on question 1 could not be circled/);
  });

  it("says nothing when everything was placed and circled", async () => {
    loadRows.mockResolvedValue([row(1, { sourcePages: [1], findings: [finding("err_0", true, "120 J")] })]);
    draw.mockResolvedValue([{ pageNumber: 1, annotated: true, reason: null, placedQuestions: [1], circled: [{ questionNumber: 1, errorId: "err_0" }] }]);
    expect((await generateMarkedCopy("sub1")).notes).toEqual([]);
  });

  it("does nothing, successfully, when there are no photographed pages (a typed assessment)", async () => {
    loadPages.mockResolvedValue([]);
    expect(await generateMarkedCopy("sub1")).toEqual({ ok: true, annotatedPages: 0, failedPages: 0, reason: null, notes: [] });
    expect(draw).not.toHaveBeenCalled();
  });

  it("never throws: a storage or drawing failure is reported, so the student keeps their unmarked pages", async () => {
    loadPages.mockRejectedValue(new Error("page missing in storage"));
    const outcome = await generateMarkedCopy("sub1");
    expect(outcome).toMatchObject({ ok: false, annotatedPages: 0 });
    expect(outcome.reason).toMatch(/could not be drawn/);

    loadPages.mockResolvedValue([PAGE]);
    loadRows.mockResolvedValue([row(1, {})]);
    draw.mockRejectedValue(new Error("textract down"));
    expect((await generateMarkedCopy("sub1")).ok).toBe(false);
  });

  it("reports a missing submission instead of throwing", async () => {
    findSubmission.mockResolvedValue(null as never);
    expect(await generateMarkedCopy("nope")).toMatchObject({ ok: false, reason: "Submission not found." });
    expect(draw).not.toHaveBeenCalled();
  });
});
