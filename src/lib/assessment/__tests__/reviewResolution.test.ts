import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    reviewItem: { findFirst: vi.fn(), updateMany: vi.fn() },
    questionResponse: { update: vi.fn(), findMany: vi.fn() },
    submission: { update: vi.fn() },
    markEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return { prisma };
});

import { prisma } from "@/lib/prisma";
import { resolveReviewItem } from "@/lib/assessment/reviewResolution";

const db = vi.mocked(prisma, true);

const grading = {
  stage: "GRADING",
  contractVersion: "1",
  generatedAt: "2026-11-04T10:00:00Z",
  warnings: [],
  awardedMarks: 3,
  maximumMarks: 4,
  outcome: "FINAL",
  evidenceSource: "AI_VERIFIED",
};

function reviewItem(confirmedAt: Date | null) {
  return {
    id: "item1",
    status: "PENDING",
    questionResponseId: "r1",
    questionResponse: {
      id: "r1",
      status: "GRADED",
      submissionId: "sub1",
      gradingResult: grading,
      annotationResult: null,
      question: { id: "q1", assessmentId: "a1", maximumMarks: 4 },
      submission: { confirmedAt },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(db)) as never);
  db.reviewItem.updateMany.mockResolvedValue({ count: 1 } as never);
  db.questionResponse.update.mockResolvedValue({} as never);
  db.questionResponse.findMany.mockResolvedValue([{ status: "GRADED" }] as never);
  db.submission.update.mockResolvedValue({} as never);
  db.markEvent.create.mockResolvedValue({} as never);
});

describe("resolveReviewItem on a submission the teacher has already confirmed", () => {
  const confirmed = new Date("2026-11-04T09:00:00Z");

  it.each([
    ["CONFIRM", {}],
    ["OVERRIDE", { overrideMarks: 1 }],
    ["DISMISS with a note for the student", { feedbackNote: "Well done" }],
  ] as const)("refuses %s and writes nothing", async (action, extra) => {
    db.reviewItem.findFirst.mockResolvedValue(reviewItem(confirmed) as never);
    const result = await resolveReviewItem({
      reviewItemId: "item1",
      teacherId: "t1",
      action: action.startsWith("DISMISS") ? "DISMISS" : (action as "CONFIRM" | "OVERRIDE"),
      ...extra,
    });

    expect(result).toMatchObject({ ok: false, code: "LOCKED" });
    expect(db.questionResponse.update).not.toHaveBeenCalled();
    expect(db.markEvent.create).not.toHaveBeenCalled();
    expect(db.reviewItem.updateMany).not.toHaveBeenCalled();
  });

  it("still lets a flag be dismissed without changing any mark or comment", async () => {
    db.reviewItem.findFirst.mockResolvedValue({ ...reviewItem(confirmed), questionResponse: { ...reviewItem(confirmed).questionResponse } } as never);
    const result = await resolveReviewItem({ reviewItemId: "item1", teacherId: "t1", action: "DISMISS" });
    expect(result).toMatchObject({ ok: true, action: "DISMISSED" });
    expect(db.questionResponse.update).not.toHaveBeenCalled();
  });
});

describe("resolveReviewItem — every mark change is in the audit trail", () => {
  it("records an accepted mark", async () => {
    db.reviewItem.findFirst.mockResolvedValue(reviewItem(null) as never);
    const result = await resolveReviewItem({ reviewItemId: "item1", teacherId: "t1", action: "CONFIRM" });

    expect(result).toMatchObject({ ok: true, awardedMarks: 3 });
    expect(db.markEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "TEACHER_ACCEPT",
      submissionId: "sub1",
      questionResponseId: "r1",
      marks: 3,
      previousMarks: 3,
      actorId: "t1",
    });
  });

  it("records a changed mark with what it replaced", async () => {
    db.reviewItem.findFirst.mockResolvedValue(reviewItem(null) as never);
    const result = await resolveReviewItem({ reviewItemId: "item1", teacherId: "t1", action: "OVERRIDE", overrideMarks: 1.5 });

    expect(result).toMatchObject({ ok: true, awardedMarks: 1.5 });
    expect(db.markEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "TEACHER_CHANGE",
      marks: 1.5,
      previousMarks: 3,
      actorId: "t1",
      payload: { reviewItemId: "item1", via: "review-queue" },
    });
  });

  it("records nothing when the item was already resolved by someone else", async () => {
    db.reviewItem.findFirst.mockResolvedValue(reviewItem(null) as never);
    db.reviewItem.updateMany.mockResolvedValue({ count: 0 } as never);
    const result = await resolveReviewItem({ reviewItemId: "item1", teacherId: "t1", action: "CONFIRM" });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(db.markEvent.create).not.toHaveBeenCalled();
  });
});
