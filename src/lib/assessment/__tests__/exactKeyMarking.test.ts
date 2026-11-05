import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    submission: { findUnique: vi.fn() },
    questionResponse: { findMany: vi.fn(), updateMany: vi.fn() },
    markEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return { prisma };
});
vi.mock("@/lib/assessment/pipelineReviewItems", () => ({ createReviewItemIfNeeded: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { decideExactKey, markExactKeyAnswers } from "@/lib/assessment/exactKeyMarking";
import { matchExactKey } from "@/lib/questions/exactKey";

const db = vi.mocked(prisma, true);
const flag = vi.mocked(createReviewItemIfNeeded);

describe("decideExactKey — code decides only what it is sure of", () => {
  const full = 2;
  const decide = (written: string, accepted: string[], readingUncertain = false) =>
    decideExactKey({ result: matchExactKey(written, accepted), fullMarks: full, readingUncertain });

  it("an exact match earns the marks", () => {
    expect(decide("B", ["B"])).toMatchObject({ kind: "MARK", awardedMarks: 2 });
    expect(decide("Nehru", ["Jawaharlal Nehru", "Nehru"])).toMatchObject({ kind: "MARK", awardedMarks: 2 });
  });

  it("a different option letter earns 0: an option cannot be a valid variant", () => {
    expect(decide("C", ["B"])).toMatchObject({ kind: "MARK", awardedMarks: 0 });
  });

  it("a different word is the teacher's call, with a proposal of 0: it may be a valid variant nobody listed", () => {
    expect(decide("Patel", ["Nehru"])).toMatchObject({ kind: "TEACHER", proposedMarks: 0 });
  });

  it("a near miss is the teacher's call with no proposal", () => {
    expect(decide("Nehroo", ["Nehru"])).toMatchObject({ kind: "TEACHER", proposedMarks: null });
  });

  it("a doubtful reading of the handwriting is never acted on, even for a clean match or an MCQ miss", () => {
    expect(decide("B", ["B"], true)).toMatchObject({ kind: "TEACHER", proposedMarks: 2 });
    expect(decide("C", ["B"], true)).toMatchObject({ kind: "TEACHER", proposedMarks: 0 });
  });

  it("nothing read is the teacher's call, never a silent zero", () => {
    expect(decide("", ["B"])).toMatchObject({ kind: "TEACHER", proposedMarks: null });
  });
});

describe("markExactKeyAnswers", () => {
  const approved = new Date("2026-11-05T09:00:00Z");
  const response = (over: Record<string, unknown> = {}, version: Record<string, unknown> | null = {}) => ({
    id: "r1",
    questionId: "q1",
    studentAnswer: { text: "B", uncertain: false },
    question: {
      maximumMarks: 1,
      answerType: "EXACT_KEY",
      rubric: version === null ? null : { activeVersion: { approvedAt: approved, criteria: [{ id: "c1", kind: "EXACT_KEY", description: "Option", marks: 1, accepted: ["B"] }], markingCheckpoints: [], structuredExpectation: null, ...version } },
    },
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.submission.findUnique.mockResolvedValue({ assessmentId: "a1" } as never);
    db.questionResponse.updateMany.mockResolvedValue({ count: 1 } as never);
    db.markEvent.create.mockResolvedValue({} as never);
    db.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(db)) as never);
  });

  it("marks a correct option in code, with an AI_DRAFT event, and tells no one", async () => {
    db.questionResponse.findMany.mockResolvedValue([response()] as never);
    expect(await markExactKeyAnswers("s1")).toBe(1);

    const data = db.questionResponse.updateMany.mock.calls[0][0].data as { status: string; gradingResult: { awardedMarks: number; outcome: string; evidenceSource: string } };
    expect(data.status).toBe("GRADED");
    expect(data.gradingResult).toMatchObject({ awardedMarks: 1, outcome: "FINAL", evidenceSource: "DETERMINISTIC" });
    expect(db.markEvent.create.mock.calls[0][0].data).toMatchObject({ kind: "AI_DRAFT", marks: 1, questionResponseId: "r1" });
    expect(flag).not.toHaveBeenCalled();
  });

  it("marks a wrong option letter 0 in code", async () => {
    db.questionResponse.findMany.mockResolvedValue([response({ studentAnswer: { text: "C", uncertain: false } })] as never);
    await markExactKeyAnswers("s1");
    expect((db.questionResponse.updateMany.mock.calls[0][0].data as { gradingResult: { awardedMarks: number } }).gradingResult.awardedMarks).toBe(0);
  });

  it("sends a doubtful reading to the teacher with the proposal, and gives it no mark", async () => {
    db.questionResponse.findMany.mockResolvedValue([response({ studentAnswer: { text: "B", uncertain: true } })] as never);
    await markExactKeyAnswers("s1");

    const data = db.questionResponse.updateMany.mock.calls[0][0].data as { status: string; gradingResult?: unknown };
    expect(data.status).toBe("NEEDS_REVIEW");
    expect(data.gradingResult).toBeUndefined();
    expect(db.markEvent.create).not.toHaveBeenCalled();
    expect(flag.mock.calls[0][0]).toMatchObject({ reason: "UNCERTAIN_CORRECTION", questionResponseId: "r1" });
    expect((flag.mock.calls[0][0].context as { proposedMarks: number }).proposedMarks).toBe(1);
  });

  it("leaves an unapproved scheme for the marking routes to park, and an unrelated answer type alone", async () => {
    db.questionResponse.findMany.mockResolvedValue([
      response({ id: "r1" }, { approvedAt: null }),
      response({ id: "r2", question: { maximumMarks: 4, answerType: "NUMERIC", rubric: { activeVersion: { approvedAt: approved, criteria: [{ id: "c1", kind: "STEP", description: "x", marks: 4 }], markingCheckpoints: [], structuredExpectation: null } } } }),
      response({ id: "r3" }, null),
    ] as never);
    expect(await markExactKeyAnswers("s1")).toBe(0);
    expect(db.questionResponse.updateMany).not.toHaveBeenCalled();
  });

  it("does not overwrite an answer a teacher finished in the meantime", async () => {
    db.questionResponse.findMany.mockResolvedValue([response()] as never);
    db.questionResponse.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await markExactKeyAnswers("s1")).toBe(0);
    expect(db.markEvent.create).not.toHaveBeenCalled();
  });

  it("never throws: a failure leaves the answers for the usual marking route", async () => {
    db.questionResponse.findMany.mockRejectedValue(new Error("db down"));
    await expect(markExactKeyAnswers("s1")).resolves.toBe(0);
  });
});
