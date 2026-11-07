import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    questionResponse: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    reviewItem: { updateMany: vi.fn() },
    markEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return { prisma };
});
vi.mock("@/lib/assessment/pipelineReviewItems", () => ({ createReviewItemIfNeeded: vi.fn() }));
vi.mock("@/lib/structuredCorrection/pipeline", () => ({ correctStructuredQuestion: vi.fn() }));
vi.mock("@/lib/structuredCorrection/textReading", async (original) => ({
  ...(await original<typeof import("@/lib/structuredCorrection/textReading")>()),
  structureTranscription: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { correctStructuredQuestion } from "@/lib/structuredCorrection/pipeline";
import { readingFromCorrectedText, structureTranscription } from "@/lib/structuredCorrection/textReading";
import { redraftWithCorrectedReading } from "@/lib/structuredCorrection/submission";

const db = vi.mocked(prisma, true);
const flag = vi.mocked(createReviewItemIfNeeded);
const correct = vi.mocked(correctStructuredQuestion);
const structure = vi.mocked(structureTranscription);

const approved = new Date("2026-11-05T09:00:00Z");
const workedCriteria = [
  { id: "c1", kind: "VALUE_POINT", description: "Adds the numbers", marks: 2 },
  { id: "c2", kind: "VALUE_POINT", description: "Divides by 3", marks: 2 },
];
const optionCriteria = [{ id: "c1", kind: "EXACT_KEY", description: "Option", marks: 1, accepted: ["B"] }];

function row(over: { criteria?: unknown; answerType?: string | null; gradingResult?: unknown; confirmedAt?: Date | null; approvedAt?: Date | null; maximumMarks?: number } = {}) {
  return {
    id: "r1",
    submissionId: "s1",
    gradingResult: over.gradingResult ?? { awardedMarks: 1, maximumMarks: 4 },
    question: {
      id: "q1",
      questionNumber: 1,
      label: null,
      questionText: "Find the mean of 2, 3, 4",
      maximumMarks: over.maximumMarks ?? 4,
      answerType: over.answerType ?? null,
      rubric: {
        activeVersion: {
          id: "rv1",
          expectedAnswer: "3",
          partialCreditGuidance: null,
          markingCheckpoints: [],
          structuredExpectation: null,
          approvedAt: over.approvedAt === undefined ? approved : over.approvedAt,
          criteria: over.criteria ?? workedCriteria,
        },
      },
    },
    submission: { assessmentId: "a1", confirmedAt: over.confirmedAt ?? null, assessment: { subject: "Maths" } },
  };
}

function score(awarded: number) {
  return {
    questionId: "q1",
    questionNumber: 1,
    reading: readingFromCorrectedText({ questionNumber: 1, text: "2+3+4=9, 9/3=3", reply: null }),
    score: {
      awardedMarks: awarded,
      maximumMarks: 4,
      outcome: "FINAL",
      marking: { runTotals: [awarded, awarded, awarded], model: "m", spread: 0, unsure: false, criteria: [], reasons: [] },
    },
    comparison: { status: "compared", errors: [] },
    verification: null,
    explanations: [],
    mistakesWithheld: false,
  };
}

function eventKinds(): string[] {
  return db.markEvent.create.mock.calls.map((call) => (call[0] as { data: { kind: string } }).data.kind);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(db)) as never);
  db.questionResponse.updateMany.mockResolvedValue({ count: 1 } as never);
  db.questionResponse.update.mockResolvedValue({} as never);
  db.reviewItem.updateMany.mockResolvedValue({ count: 1 } as never);
  db.markEvent.create.mockResolvedValue({} as never);
  structure.mockImplementation(async (input) => ({
    ok: true,
    reading: readingFromCorrectedText({ questionNumber: input.questionNumber, text: input.text, reply: null }),
  }));
});

describe("redraftWithCorrectedReading, answers marked against a scheme", () => {
  function inTransaction(over: { gradingResult?: unknown; confirmedAt?: Date | null } = {}) {
    db.questionResponse.findUnique.mockImplementation((async (args: { select: Record<string, unknown> }) =>
      args.select.studentAnswer
        ? { studentAnswer: { text: "old text" } }
        : { gradingResult: over.gradingResult ?? null, submission: { confirmedAt: over.confirmedAt ?? null } }) as never);
  }

  it("stores the typed text, marks again from it, and keeps every record", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row() as never);
    inTransaction();
    correct.mockResolvedValue(score(4) as never);

    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "2+3+4=9, 9/3=3" });
    expect(result).toEqual({ ok: true });

    expect(correct.mock.calls[0][0].reading.transcription).toBe("2+3+4=9, 9/3=3");
    expect(eventKinds()).toContain("TEACHER_TRANSCRIPTION");
    expect(eventKinds()).toContain("AI_DRAFT");
    const draft = db.markEvent.create.mock.calls.find((call) => (call[0] as { data: { kind: string } }).data.kind === "AI_DRAFT")![0] as {
      data: { marks: number; payload: { redraft: boolean } };
    };
    expect(draft.data.marks).toBe(4);
    expect(draft.data.payload.redraft).toBe(true);
    const textWrite = db.questionResponse.update.mock.calls[0][0] as { data: { studentAnswer: Record<string, unknown> } };
    expect(textWrite.data.studentAnswer).toMatchObject({ text: "2+3+4=9, 9/3=3", originalText: "old text", correctedByTeacher: true });
    expect(db.reviewItem.updateMany).toHaveBeenCalled();
  });

  it("refuses once the marks are confirmed, and calls no model", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ confirmedAt: new Date() }) as never);
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" });
    expect(result.ok).toBe(false);
    expect(structure).not.toHaveBeenCalled();
    expect(correct).not.toHaveBeenCalled();
  });

  it("refuses an answer the teacher has already decided", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ gradingResult: { awardedMarks: 1, teacherReview: { action: "ACCEPTED" } } }) as never);
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" });
    expect(result.ok).toBe(false);
    expect(correct).not.toHaveBeenCalled();
  });

  it("refuses when the scheme is not approved", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ approvedAt: null }) as never);
    expect((await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" })).ok).toBe(false);
    expect(correct).not.toHaveBeenCalled();
  });

  it("another teacher's answer is simply not found", async () => {
    db.questionResponse.findFirst.mockResolvedValue(null as never);
    expect(await redraftWithCorrectedReading({ responseId: "r1", teacherId: "other", text: "x" })).toEqual({ ok: false, message: "Answer not found." });
    expect(db.questionResponse.findFirst.mock.calls[0][0]).toMatchObject({ where: { submission: { assessment: { teacherId: "other" } } } });
  });

  it("refuses text that is too long", async () => {
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x".repeat(5000) });
    expect(result.ok).toBe(false);
    expect(db.questionResponse.findFirst).not.toHaveBeenCalled();
  });

  it("leaves everything as it was when marking could not be completed", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row() as never);
    correct.mockResolvedValue({ ...score(0), score: null } as never);
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" });
    expect(result.ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.questionResponse.update).not.toHaveBeenCalled();
  });

  it("stores nothing, not even the text, when the answer was decided while it was being marked", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row() as never);
    inTransaction({ gradingResult: { teacherReview: { action: "ACCEPTED" } } });
    correct.mockResolvedValue(score(4) as never);
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" });
    expect(result.ok).toBe(false);
    expect(db.questionResponse.update).not.toHaveBeenCalled();
    expect(db.markEvent.create).not.toHaveBeenCalled();
  });

  it("does not mark an answer written in another language; the teacher does", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row() as never);
    structure.mockResolvedValue({
      ok: true,
      reading: readingFromCorrectedText({ questionNumber: 1, text: "उत्तर 3", reply: { segments: [{ language: "Hindi" }] } }),
    });
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "उत्तर 3" });
    expect(result.ok).toBe(false);
    expect(correct).not.toHaveBeenCalled();
  });

  it("changes nothing when the corrected text could not be prepared", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row() as never);
    structure.mockResolvedValue({ ok: false, message: "try again" });
    expect(await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "x" })).toEqual({ ok: false, message: "try again" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("redraftWithCorrectedReading, answers marked by exact match", () => {
  function inTransaction(status = "GRADED", over: { gradingResult?: unknown; confirmedAt?: Date | null } = {}) {
    db.questionResponse.findUnique.mockImplementation((async (args: { select: Record<string, unknown> }) =>
      args.select.studentAnswer
        ? { studentAnswer: { text: "C" } }
        : { status, gradingResult: over.gradingResult ?? null, submission: { confirmedAt: over.confirmedAt ?? null } }) as never);
  }

  it("a misread option letter, corrected to the right one, now earns the marks, with no model", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ criteria: optionCriteria, maximumMarks: 1, answerType: "EXACT_KEY" }) as never);
    inTransaction();
    expect(await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "B" })).toEqual({ ok: true });
    expect(structure).not.toHaveBeenCalled();
    expect(correct).not.toHaveBeenCalled();
    const write = db.questionResponse.update.mock.calls[0][0] as { data: { status: string; gradingResult: { awardedMarks: number } } };
    expect(write.data).toMatchObject({ status: "GRADED", gradingResult: { awardedMarks: 1 } });
    expect(eventKinds()).toEqual(["TEACHER_TRANSCRIPTION", "AI_DRAFT"]);
  });

  it("a corrected wrong option earns 0", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ criteria: optionCriteria, maximumMarks: 1, answerType: "EXACT_KEY" }) as never);
    inTransaction();
    await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "D" });
    const write = db.questionResponse.update.mock.calls[0][0] as { data: { gradingResult: { awardedMarks: number } } };
    expect(write.data.gradingResult.awardedMarks).toBe(0);
  });

  it("a near miss goes back to the teacher and the earlier mark no longer stands", async () => {
    db.questionResponse.findFirst.mockResolvedValue(
      row({ criteria: [{ id: "c1", kind: "EXACT_KEY", description: "Name", marks: 1, accepted: ["Nehru"] }], maximumMarks: 1, answerType: "EXACT_KEY" }) as never,
    );
    inTransaction();
    await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "Nehroo" });
    const write = db.questionResponse.update.mock.calls[0][0] as { data: { status: string; gradingResult: unknown } };
    expect(write.data.status).toBe("NEEDS_REVIEW");
    expect(write.data.gradingResult).toBeDefined();
    expect(write.data.gradingResult).not.toMatchObject({ awardedMarks: expect.anything() });
    expect(flag).toHaveBeenCalledOnce();
  });

  it("changes nothing when the answer was decided or confirmed meanwhile", async () => {
    db.questionResponse.findFirst.mockResolvedValue(row({ criteria: optionCriteria, maximumMarks: 1, answerType: "EXACT_KEY" }) as never);
    inTransaction("GRADED", { gradingResult: { teacherReview: { action: "OVERRIDDEN" } } });
    const result = await redraftWithCorrectedReading({ responseId: "r1", teacherId: "t1", text: "B" });
    expect(result.ok).toBe(false);
    expect(db.questionResponse.update).not.toHaveBeenCalled();
    expect(db.markEvent.create).not.toHaveBeenCalled();
  });
});
