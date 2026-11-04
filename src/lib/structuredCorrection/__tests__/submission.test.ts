import { beforeEach, describe, expect, it, vi } from "vitest";

// Everything outside this module is replaced: no database, no models, no storage.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    submission: { findUnique: vi.fn() },
    question: { findMany: vi.fn() },
    questionResponse: { findMany: vi.fn(), update: vi.fn() },
  },
}));
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
import { runStructuredCorrectionForSubmission } from "@/lib/structuredCorrection/submission";
import type { ReconciledReading } from "@/types/structuredCorrection";

const db = vi.mocked(prisma, true);
const flagForTeacher = vi.mocked(createReviewItemIfNeeded);
const loadPages = vi.mocked(loadOrderedAnswerSheetPages);
const readSheet = vi.mocked(readStructuredAnswers);
const correct = vi.mocked(correctStructuredQuestion);

const SUBMISSION = "sub1";

function questionRow(number: number) {
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
  db.question.findMany.mockResolvedValue(questionNumbers.map(questionRow) as never);
  db.questionResponse.findMany.mockResolvedValue(responses as never);
  db.questionResponse.update.mockResolvedValue({} as never);
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
    const graded = db.questionResponse.update.mock.calls.filter(([args]) => (args.data as { status?: string }).status === "GRADED");
    expect(graded.map(([args]) => args.where.id)).toEqual(["r1"]);
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
