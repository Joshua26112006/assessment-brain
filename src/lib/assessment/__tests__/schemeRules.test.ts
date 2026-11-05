import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const prisma = {
    question: { findFirst: vi.fn() },
    assessment: { findFirst: vi.fn() },
    rubricVersion: { updateMany: vi.fn() },
  };
  return { prisma };
});
// schemeReapply imports these; they are not exercised here.
vi.mock("@/lib/assessment/pipelineReviewItems", () => ({ createReviewItemIfNeeded: vi.fn() }));
vi.mock("@/lib/assessment/submissionStatusSync", () => ({ recalculateSubmissionStatus: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { computeAssessmentReadiness, describeAssessmentReadiness } from "@/lib/assessment/readiness";
import { approveAllSchemes, approveScheme } from "@/lib/assessment/schemeApproval";
import { reapplyAction } from "@/lib/assessment/schemeReapply";
import { mayMarkAgainst } from "@/lib/assessment/schemeGate";

const db = vi.mocked(prisma, true);

describe("readiness counts an unapproved scheme as not ready", () => {
  const q = (id: string, n: number, approvedAt: Date | null, generationStatus = "READY") => ({
    id,
    questionNumber: n,
    maximumMarks: 4,
    rubric: { generationStatus, activeVersionId: "v", generationError: null, activeVersion: { approvedAt } },
  });

  it("a ready, approved scheme is READY", () => {
    const r = computeAssessmentReadiness([q("a", 1, new Date())]);
    expect(r.isReady).toBe(true);
    expect(r.readyCount).toBe(1);
  });

  it("a generated scheme nobody approved is AWAITING_APPROVAL and blocks publishing", () => {
    const r = computeAssessmentReadiness([q("a", 1, new Date()), q("b", 2, null)]);
    expect(r.isReady).toBe(false);
    expect(r.awaitingApprovalCount).toBe(1);
    expect(r.questions[1].bucket).toBe("AWAITING_APPROVAL");
    const message = describeAssessmentReadiness(r);
    expect(message.headline).toMatch(/Approve/);
    expect(message.message).toMatch(/question 2/);
  });

  it("an unapproved scheme with no active version is still just pending", () => {
    const r = computeAssessmentReadiness([
      { id: "a", questionNumber: 1, maximumMarks: 4, rubric: { generationStatus: "PENDING", activeVersionId: null, generationError: null } },
    ]);
    expect(r.questions[0].bucket).toBe("PENDING");
  });
});

describe("mayMarkAgainst", () => {
  it("needs an approved version", () => {
    expect(mayMarkAgainst({ approvedAt: new Date() })).toBe(true);
    expect(mayMarkAgainst({ approvedAt: null })).toBe(false);
    expect(mayMarkAgainst(null)).toBe(false);
  });
});

describe("reapplyAction (decision D13)", () => {
  const base = { status: "GRADED", gradingResult: null, submissionConfirmed: false, heldForScheme: false };
  const teacherReviewed = { stage: "GRADING", contractVersion: "1", generatedAt: "x", warnings: [], awardedMarks: 3, maximumMarks: 4, outcome: "FINAL", evidenceSource: "AI_VERIFIED", teacherReview: { action: "CONFIRMED" } };

  it("marks an unreviewed AI draft again", () => {
    expect(reapplyAction(base)).toBe("RERUN");
  });

  it("marks again an answer parked because the scheme was not approved", () => {
    expect(reapplyAction({ ...base, status: "NEEDS_REVIEW", heldForScheme: true })).toBe("RERUN");
  });

  it("never overwrites a mark a teacher accepted or changed: it flags the change instead", () => {
    expect(reapplyAction({ ...base, gradingResult: teacherReviewed })).toBe("FLAG_CHANGED");
  });

  it("never overwrites anything in a confirmed submission", () => {
    expect(reapplyAction({ ...base, submissionConfirmed: true })).toBe("FLAG_CHANGED");
    expect(reapplyAction({ ...base, submissionConfirmed: true, status: "NEEDS_REVIEW", heldForScheme: true })).toBe("FLAG_CHANGED");
  });

  it("leaves an answer still being marked, or flagged for another reason, alone", () => {
    expect(reapplyAction({ ...base, status: "CORRECTING" })).toBe("LEAVE");
    expect(reapplyAction({ ...base, status: "PENDING" })).toBe("LEAVE");
    expect(reapplyAction({ ...base, status: "NEEDS_REVIEW" })).toBe("LEAVE");
    expect(reapplyAction({ ...base, status: "FAILED" })).toBe("LEAVE");
  });
});

describe("approveScheme", () => {
  const questionWith = (version: Record<string, unknown> | null) => ({
    maximumMarks: 4,
    rubric: version ? { activeVersionId: "v1", activeVersion: { id: "v1", approvedAt: null, criteria: null, markingCheckpoints: [], followThrough: null, noWorkingRule: null, acceptedAlternatives: null, ...version } } : null,
  });
  const goodCheckpoints = [
    { description: "Formula", marks: 2 },
    { description: "Answer", marks: 2 },
  ];

  beforeEach(() => vi.clearAllMocks());

  it("is not found for a question another teacher owns (ownership is in the query)", async () => {
    db.question.findFirst.mockResolvedValue(null);
    const result = await approveScheme({ teacherId: "other", questionId: "q1" });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.question.findFirst.mock.calls[0][0]!.where).toMatchObject({ assessment: { teacherId: "other" } });
    expect(db.rubricVersion.updateMany).not.toHaveBeenCalled();
  });

  it("has nothing to approve when no scheme exists", async () => {
    db.question.findFirst.mockResolvedValue(questionWith(null) as never);
    expect(await approveScheme({ teacherId: "t", questionId: "q1" })).toMatchObject({ ok: false, code: "NO_SCHEME" });
  });

  it("refuses a scheme whose criteria do not add up, and changes nothing", async () => {
    db.question.findFirst.mockResolvedValue(
      questionWith({ criteria: [{ id: "c1", kind: "STEP", description: "x", marks: 1 }] }) as never,
    );
    const result = await approveScheme({ teacherId: "t", questionId: "q1" });
    expect(result).toMatchObject({ ok: false, code: "SCHEME_INVALID" });
    expect(db.rubricVersion.updateMany).not.toHaveBeenCalled();
  });

  it("approves a valid scheme once, recording who and when, and activates the version", async () => {
    db.question.findFirst.mockResolvedValue(questionWith({ markingCheckpoints: goodCheckpoints }) as never);
    db.rubricVersion.updateMany.mockResolvedValue({ count: 1 } as never);
    const result = await approveScheme({ teacherId: "t", questionId: "q1" });
    expect(result).toEqual({ ok: true, alreadyApproved: false, versionId: "v1" });
    const call = db.rubricVersion.updateMany.mock.calls[0][0]!;
    expect(call.where).toEqual({ id: "v1", approvedAt: null });
    expect(call.data).toMatchObject({ approvedById: "t", status: "ACTIVE" });
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it("a second click reports already approved and writes nothing new", async () => {
    db.question.findFirst.mockResolvedValue(questionWith({ approvedAt: new Date(), markingCheckpoints: goodCheckpoints }) as never);
    const result = await approveScheme({ teacherId: "t", questionId: "q1" });
    expect(result).toMatchObject({ ok: true, alreadyApproved: true });
    expect(db.rubricVersion.updateMany).not.toHaveBeenCalled();
  });

  it("a lost race (another tab approved first) is also reported as already approved", async () => {
    db.question.findFirst.mockResolvedValue(questionWith({ markingCheckpoints: goodCheckpoints }) as never);
    db.rubricVersion.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await approveScheme({ teacherId: "t", questionId: "q1" })).toMatchObject({ ok: true, alreadyApproved: true });
  });
});

describe("approveAllSchemes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an assessment the teacher does not own", async () => {
    db.assessment.findFirst.mockResolvedValue(null);
    expect(await approveAllSchemes({ teacherId: "other", assessmentId: "a1" })).toBeNull();
    expect(db.assessment.findFirst.mock.calls[0][0]!.where).toMatchObject({ teacherId: "other" });
  });

  it("approves what is valid and reports what it skipped and why, never approving an invalid scheme", async () => {
    db.assessment.findFirst.mockResolvedValue({
      questions: [
        { id: "q1", questionNumber: 1 },
        { id: "q2", questionNumber: 2 },
      ],
    } as never);
    db.question.findFirst
      .mockResolvedValueOnce({
        maximumMarks: 4,
        rubric: { activeVersionId: "v1", activeVersion: { id: "v1", approvedAt: null, criteria: null, markingCheckpoints: [{ description: "x", marks: 4 }], followThrough: null, noWorkingRule: null, acceptedAlternatives: null } },
      } as never)
      .mockResolvedValueOnce({ maximumMarks: 4, rubric: null } as never);
    db.rubricVersion.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await approveAllSchemes({ teacherId: "t", assessmentId: "a1" });
    expect(result).toMatchObject({ approved: 1, alreadyApproved: 0, newlyApprovedQuestionIds: ["q1"] });
    expect(result!.skipped).toEqual([{ questionNumber: 2, message: expect.stringMatching(/no marking scheme/) }]);
  });
});
