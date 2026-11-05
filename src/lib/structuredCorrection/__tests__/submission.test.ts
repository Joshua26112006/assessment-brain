import { beforeEach, describe, expect, it, vi } from "vitest";

// Everything outside this module is replaced: no database, no models, no storage.
vi.mock("@/lib/prisma", () => {
  const prisma = {
    submission: { findUnique: vi.fn() },
    question: { findMany: vi.fn() },
    questionResponse: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    markEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  // The transaction callback simply runs against the same mocked client.
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return { prisma };
});
vi.mock("@/lib/assessment/pipelineReviewItems", () => ({ createReviewItemIfNeeded: vi.fn() }));
vi.mock("@/lib/handwritten/pages", () => ({ loadOrderedAnswerSheetPages: vi.fn() }));
vi.mock("@/lib/structuredCorrection/structuredReading", () => ({ readStructuredAnswers: vi.fn() }));
vi.mock("@/lib/structuredCorrection/pipeline", () => ({ correctStructuredQuestion: vi.fn() }));
vi.mock("@/lib/structuredCorrection/annotation", () => ({ annotateAnswerSheet: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { readStructuredAnswers } from "@/lib/structuredCorrection/structuredReading";
import { correctStructuredQuestion } from "@/lib/structuredCorrection/pipeline";
import { annotateAnswerSheet } from "@/lib/structuredCorrection/annotation";
import { runStructuredCorrectionForSubmission } from "@/lib/structuredCorrection/submission";
import type { ReconciledReading } from "@/types/structuredCorrection";

const db = vi.mocked(prisma, true);
const flagForTeacher = vi.mocked(createReviewItemIfNeeded);
const loadPages = vi.mocked(loadOrderedAnswerSheetPages);
const readSheet = vi.mocked(readStructuredAnswers);
const correct = vi.mocked(correctStructuredQuestion);
const drawOnPages = vi.mocked(annotateAnswerSheet);

const SUBMISSION = "sub1";

function questionRow(number: number, approved = true) {
  return {
    id: `q${number}`,
    questionNumber: number,
    questionText: `Question ${number}`,
    maximumMarks: 4,
    rubric: {
      activeVersionId: "rv1",
      activeVersion: {
        id: "rv1",
        expectedAnswer: "4",
        partialCreditGuidance: null,
        markingCheckpoints: [],
        structuredExpectation: null,
        // A teacher has approved the scheme (decision D8); without this nothing is marked.
        approvedAt: approved ? new Date("2026-11-05T09:00:00Z") : null,
      },
    },
  };
}

function responseRow(number: number, status = "PENDING", text = "some writing") {
  return { id: `r${number}`, questionId: `q${number}`, status, studentAnswer: { sourcePages: [1], text } };
}

function reading(number: number, overrides: Partial<ReconciledReading> = {}): ReconciledReading {
  return {
    questionNumber: number,
    transcription: "x = 4",
    attempted: true,
    agreementConfidence: "high",
    problemType: "unknown",
    steps: [],
    variables: {},
    studentAnswer: { raw: "4", parsed: 4 },
    structureConfidence: "high",
    ...overrides,
  };
}

function setUpSubmission(questionNumbers: number[], responses = questionNumbers.map((n) => responseRow(n))) {
  db.submission.findUnique.mockResolvedValue({
    id: SUBMISSION,
    assessmentId: "a1",
    assessment: { subject: "Physics" },
  } as never);
  db.question.findMany.mockResolvedValue(questionNumbers.map((n) => questionRow(n)) as never);
  db.questionResponse.findMany.mockResolvedValue(responses as never);
  db.questionResponse.update.mockResolvedValue({} as never);
  db.questionResponse.updateMany.mockResolvedValue({ count: 1 } as never);
  db.markEvent.create.mockResolvedValue({} as never);
  db.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(db)) as never);
  loadPages.mockResolvedValue([{ pageId: "p1", pageNumber: 1, mimeType: "image/png", buffer: Buffer.from("") }]);
}

/** Every response that was moved to NEEDS_REVIEW, as response ids. */
function flaggedResponseIds(): string[] {
  return db.questionResponse.update.mock.calls
    .filter(([args]) => (args.data as { status?: string }).status === "NEEDS_REVIEW")
    .map(([args]) => args.where.id as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runStructuredCorrectionForSubmission — nothing is marked against an unapproved scheme (D8)", () => {
  it("parks an answer whose scheme has no approval, with a clear reason, and never calls the marker for it", async () => {
    setUpSubmission([1]);
    db.question.findMany.mockResolvedValue([questionRow(1, false)] as never);
    readSheet.mockResolvedValue(new Map());

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(correct).not.toHaveBeenCalled();
    expect(readSheet).not.toHaveBeenCalled();
    expect(db.questionResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "r1" }), data: { status: "NEEDS_REVIEW" } }),
    );
    expect(flagForTeacher).toHaveBeenCalledTimes(1);
    expect(flagForTeacher.mock.calls[0][0]).toMatchObject({ reason: "SCHEME_NOT_APPROVED", questionResponseId: "r1", submissionId: SUBMISSION });
  });

  it("still marks the questions whose schemes ARE approved, in the same submission", async () => {
    setUpSubmission([1, 2]);
    db.question.findMany.mockResolvedValue([questionRow(1, false), questionRow(2, true)] as never);
    readSheet.mockResolvedValue(new Map([[2, reading(2)]]));
    correct.mockResolvedValue({ score: null, explanations: [], reading: reading(2), comparison: { status: "compared", matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 }, verification: null, findings: [] } as never);

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct.mock.calls[0][0].questionNumber).toBe(2);
    expect(flagForTeacher.mock.calls.some(([args]) => args.reason === "SCHEME_NOT_APPROVED" && args.questionResponseId === "r1")).toBe(true);
  });

  it("does not hold a question that has no rubric version at all differently from before: it is held too", async () => {
    setUpSubmission([1]);
    db.question.findMany.mockResolvedValue([{ ...questionRow(1), rubric: null }] as never);

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(correct).not.toHaveBeenCalled();
    expect(flagForTeacher.mock.calls[0][0]).toMatchObject({ reason: "SCHEME_NOT_APPROVED" });
  });
});

describe("runStructuredCorrectionForSubmission — nothing is ever left pending with nobody told", () => {
  it("sends every question to a teacher when the answer sheet cannot be read at all", async () => {
    setUpSubmission([1, 2, 3]);
    readSheet.mockRejectedValue(new Error("both reading passes failed"));

    await expect(runStructuredCorrectionForSubmission(SUBMISSION)).resolves.toBeUndefined();

    expect(flaggedResponseIds().sort()).toEqual(["r1", "r2", "r3"]);
    expect(flagForTeacher).toHaveBeenCalledTimes(3);
    for (const [args] of flagForTeacher.mock.calls) {
      expect(args.reason).toBe("AMBIGUOUS_EXTRACTION");
      expect(args.submissionId).toBe(SUBMISSION);
      expect((args.context as { detail: string }).detail).toMatch(/could not be read/);
    }
    expect(correct).not.toHaveBeenCalled();
  });

  it("also covers a failure while loading the pages", async () => {
    setUpSubmission([1]);
    loadPages.mockRejectedValue(new Error("storage unavailable"));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(flaggedResponseIds()).toEqual(["r1"]);
    expect(flagForTeacher).toHaveBeenCalledTimes(1);
  });

  it("does not touch responses that are already finished", async () => {
    setUpSubmission([1, 2], [responseRow(1, "GRADED"), responseRow(2, "PENDING")]);
    readSheet.mockRejectedValue(new Error("down"));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(flaggedResponseIds()).toEqual(["r2"]);
  });

  it("flags only the question that threw, and still marks the others", async () => {
    setUpSubmission([1, 2]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)], [2, reading(2)]]));
    correct.mockImplementation(async (input) => {
      if (input.questionNumber === 2) throw new Error("boom");
      return {
        questionId: input.questionId,
        questionNumber: input.questionNumber,
        reading: input.reading,
        score: { awardedMarks: 3, maximumMarks: 4, feedback: "ok" },
        comparison: { status: "skipped_unsolvable", matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 },
        verification: null,
        explanations: [],
        mistakesWithheld: false,
      };
    });

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(flaggedResponseIds()).toEqual(["r2"]);
    const graded = db.questionResponse.updateMany.mock.calls.filter(([args]) => (args.data as { status?: string }).status === "GRADED");
    expect(graded.map(([args]) => args.where!.id)).toEqual(["r1"]);
  });

  it("flags a question the sheet reader skipped even though writing was mapped to it", async () => {
    setUpSubmission([1, 2]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]])); // nothing at all for question 2

    correct.mockImplementation(async (input) => ({
      questionId: input.questionId,
      questionNumber: input.questionNumber,
      reading: input.reading,
      score: { awardedMarks: 4, maximumMarks: 4, feedback: "ok" },
      comparison: { status: "skipped_unsolvable", matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 },
      verification: null,
      explanations: [],
      mistakesWithheld: false,
    }));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(flaggedResponseIds()).toEqual(["r2"]);
    expect(correct).toHaveBeenCalledTimes(1);
  });

  it("flags a question the reader calls 'not attempted' when the mapping found text for it, instead of marking it 0", async () => {
    setUpSubmission([1], [responseRow(1, "PENDING", "x = 4")]);
    readSheet.mockResolvedValue(new Map([[1, reading(1, { attempted: false, transcription: "" })]]));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(flaggedResponseIds()).toEqual(["r1"]);
    expect(correct).not.toHaveBeenCalled();
  });

  it("does not let a failure to record the flag hide the others or throw", async () => {
    setUpSubmission([1, 2]);
    readSheet.mockRejectedValue(new Error("down"));
    flagForTeacher.mockRejectedValueOnce(new Error("review item write failed"));

    await expect(runStructuredCorrectionForSubmission(SUBMISSION)).resolves.toBeUndefined();

    expect(flagForTeacher).toHaveBeenCalledTimes(2);
  });
});

describe("runStructuredCorrectionForSubmission — what a teacher gets to review", () => {
  const explanation = {
    errorId: "err_0",
    explanationType: "root_arithmetic_error" as const,
    explanation: "Here the value should be 100, but you wrote 120 J.",
    wrongText: "120 J",
    correctVersion: "100",
  };

  function markedWithFinding(input: Parameters<typeof correctStructuredQuestion>[0]) {
    return {
      questionId: input.questionId,
      questionNumber: input.questionNumber,
      reading: input.reading,
      score: { awardedMarks: 2, maximumMarks: 4, feedback: "ok" },
      comparison: { status: "compared" as const, matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 },
      verification: null,
      explanations: [explanation],
      mistakesWithheld: false,
    };
  }

  it("stores each finding so the teacher can keep or remove it", async () => {
    setUpSubmission([1]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]]));
    correct.mockImplementation(async (input) => markedWithFinding(input));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    const graded = db.questionResponse.updateMany.mock.calls.find(([args]) => (args.data as { status?: string }).status === "GRADED");
    const stored = (graded![0].data as { correctionResult: { findings: unknown[] } }).correctionResult;
    expect(stored.findings).toEqual([
      {
        id: "err_0",
        type: "root_arithmetic_error",
        explanation: "Here the value should be 100, but you wrote 120 J.",
        wrongText: "120 J",
        correctVersion: "100",
      },
    ]);
  });

  it("draws nothing on the student's pages — that happens at release, from the teacher's final marks", async () => {
    setUpSubmission([1, 2]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)], [2, reading(2)]]));
    correct.mockImplementation(async (input) => markedWithFinding(input));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(correct).toHaveBeenCalledTimes(2);
    expect(drawOnPages).not.toHaveBeenCalled();
  });
});

describe("runStructuredCorrectionForSubmission — the audit trail starts with the AI's own mark", () => {
  const marked = (input: Parameters<typeof correctStructuredQuestion>[0], awarded: number | null) => ({
    questionId: input.questionId,
    questionNumber: input.questionNumber,
    reading: input.reading,
    score: awarded === null ? null : { awardedMarks: awarded, maximumMarks: 4, feedback: "ok" },
    comparison: { status: "skipped_unsolvable" as const, matchedApproachLabel: null, errors: [], matchedVariableCount: 0, totalExpectedVariableCount: 0 },
    verification: null,
    explanations: [],
    mistakesWithheld: false,
  });

  it("records an AI_DRAFT event with the mark, in the same transaction as the mark itself", async () => {
    setUpSubmission([1]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]]));
    correct.mockImplementation(async (input) => marked(input, 3));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.markEvent.create).toHaveBeenCalledTimes(1);
    expect(db.markEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "AI_DRAFT",
      submissionId: SUBMISSION,
      questionResponseId: "r1",
      marks: 3,
    });
  });

  it("keeps every marking run as its own AI_RUN event, so the median can always be re-derived", async () => {
    setUpSubmission([1]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]]));
    correct.mockImplementation(async (input) => ({
      ...marked(input, 4),
      score: {
        awardedMarks: 4,
        maximumMarks: 4,
        feedback: "ok",
        marking: { criteria: [], runTotals: [4, 3, 4], spread: 1, unsure: false, reasons: [], model: "judge-model" },
      },
    }));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    const events = db.markEvent.create.mock.calls.map(([args]) => args.data as { kind: string; marks: number; payload: Record<string, unknown> });
    expect(events.map((e) => [e.kind, e.marks])).toEqual([["AI_RUN", 4], ["AI_RUN", 3], ["AI_RUN", 4], ["AI_DRAFT", 4]]);
    expect(events[0].payload).toMatchObject({ run: 1, of: 3, model: "judge-model" });
    expect(events[3].payload).toMatchObject({ method: "MEDIAN_OF_RUNS", runTotals: [4, 3, 4], spread: 1 });
    // The marking detail is stored with the answer so the teacher can see how the mark was reached.
    const stored = db.questionResponse.updateMany.mock.calls[0][0].data as { correctionResult: { marking: { runTotals: number[] } } };
    expect(stored.correctionResult.marking.runTotals).toEqual([4, 3, 4]);
  });

  it("records no draft when marking produced no mark", async () => {
    setUpSubmission([1]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]]));
    correct.mockImplementation(async (input) => marked(input, null));

    await runStructuredCorrectionForSubmission(SUBMISSION);

    expect(db.markEvent.create).not.toHaveBeenCalled();
  });

  it("does not overwrite an answer a teacher finished while the AI was still working", async () => {
    setUpSubmission([1]);
    readSheet.mockResolvedValue(new Map([[1, reading(1)]]));
    correct.mockImplementation(async (input) => marked(input, 3));
    db.questionResponse.updateMany.mockResolvedValue({ count: 0 } as never); // the teacher got there first

    await runStructuredCorrectionForSubmission(SUBMISSION);

    // The write is conditional on the answer not being finished already...
    expect(db.questionResponse.updateMany.mock.calls[0][0].where!).toMatchObject({
      id: "r1",
      status: { notIn: ["GRADED", "NEEDS_REVIEW", "FAILED"] },
    });
    // ...and when it matched nothing, no AI mark is recorded for it.
    expect(db.markEvent.create).not.toHaveBeenCalled();
  });
});

