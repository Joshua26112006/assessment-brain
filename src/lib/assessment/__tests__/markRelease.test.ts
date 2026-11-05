/* eslint-disable @typescript-eslint/no-explicit-any -- the fake database below is deliberately loosely typed */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the handful of tables these functions touch,
// so the tests check what actually ends up stored — marks, locks, audit rows —
// rather than only which calls were made.
// ---------------------------------------------------------------------------

const TEACHER = "teacher1";
const OTHER_TEACHER = "teacher2";

interface Db {
  submissions: any[];
  questions: any[];
  responses: any[];
  reviewItems: any[];
  events: any[];
  pages: any[];
}

let db: Db;
let nextId = 1;

function submissionOf(response: any) {
  return db.submissions.find((s) => s.id === response.submissionId);
}

const fake: any = {
  async $transaction(callback: (tx: unknown) => unknown) {
    return callback(fake);
  },
  submission: {
    async findFirst({ where }: any) {
      const found = db.submissions.find((s) => s.id === where.id && s.teacherId === where.assessment.teacherId);
      return found ? { ...found } : null;
    },
    async updateMany({ where, data }: any) {
      const matches = db.submissions.filter(
        (s) =>
          s.id === where.id &&
          (!("confirmedAt" in where) ||
            (where.confirmedAt === null ? s.confirmedAt === null : where.confirmedAt?.not === null ? s.confirmedAt !== null : true)) &&
          (!("releasedAt" in where) || (where.releasedAt === null ? s.releasedAt === null : true)),
      );
      matches.forEach((s) => Object.assign(s, data));
      return { count: matches.length };
    },
    async update({ where, data }: any) {
      const found = db.submissions.find((s) => s.id === where.id);
      Object.assign(found, data);
      return found;
    },
  },
  question: {
    async findMany({ where }: any) {
      return db.questions.filter((q) => q.assessmentId === where.assessmentId).sort((a, b) => a.questionNumber - b.questionNumber);
    },
  },
  questionResponse: {
    async findFirst({ where }: any) {
      const found = db.responses.find((r) => r.id === where.id && submissionOf(r)?.teacherId === where.submission.assessment.teacherId);
      if (!found) return null;
      const question = db.questions.find((q) => q.id === found.questionId);
      return { ...found, question: { maximumMarks: question.maximumMarks }, submission: { confirmedAt: submissionOf(found).confirmedAt } };
    },
    async findMany({ where }: any) {
      return db.responses
        .filter((r) => r.submissionId === where.submissionId)
        .map((r) => ({
          ...r,
          reviewItems: db.reviewItems.filter((i) => i.questionResponseId === r.id && ["PENDING", "IN_REVIEW"].includes(i.status)),
        }));
    },
    async updateMany({ where, data }: any) {
      const matches = db.responses.filter(
        (r) => r.id === where.id && (where.submission?.confirmedAt !== null || submissionOf(r).confirmedAt === null),
      );
      matches.forEach((r) => Object.assign(r, data));
      return { count: matches.length };
    },
    async create({ data }: any) {
      const row = { id: `r${nextId++}`, annotationResult: null, correctionResult: null, ...data };
      db.responses.push(row);
      return { id: row.id };
    },
  },
  reviewItem: {
    async updateMany({ where, data }: any) {
      const matches = db.reviewItems.filter((i) => i.questionResponseId === where.questionResponseId && where.status.in.includes(i.status));
      matches.forEach((i) => Object.assign(i, data));
      return { count: matches.length };
    },
  },
  answerSheetPage: {
    async findMany({ where }: any) {
      return db.pages.filter((p) => p.submissionId === where.submissionId && p.annotatedStorageKey !== null).map((p) => ({ annotatedStorageKey: p.annotatedStorageKey }));
    },
    async updateMany({ where, data }: any) {
      const matches = db.pages.filter((p) => p.submissionId === where.submissionId && p.annotatedStorageKey !== null);
      matches.forEach((p) => Object.assign(p, data));
      return { count: matches.length };
    },
  },
  markEvent: {
    async create({ data }: any) {
      db.events.push({ id: `e${nextId++}`, createdAt: new Date(), ...data });
      return data;
    },
  },
};

// vi.mock is hoisted above `fake`, so the client is looked up lazily, at call time.
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_target, property) => fake[property as string] }) }));

const removedFiles: string[] = [];
vi.mock("@/lib/storage/answerSheets", () => ({ removeAnnotatedAnswerSheetPage: async (key: string) => { removedFiles.push(key); } }));

import {
  acceptAllSure,
  acceptDraft,
  changeMark,
  confirmSubmission,
  loadSubmissionReview,
  releaseSubmission,
  reopenSubmission,
  setComment,
  setFindingKept,
} from "@/lib/assessment/markRelease";

// ---------------------------------------------------------------------------
// Seed data: one assessment owned by TEACHER with three questions (4 marks each).
// ---------------------------------------------------------------------------

const grading = (marks: number, extra: Record<string, unknown> = {}) => ({
  stage: "GRADING",
  contractVersion: "1",
  generatedAt: "2026-11-04T10:00:00Z",
  warnings: [],
  awardedMarks: marks,
  maximumMarks: 4,
  outcome: "FINAL",
  evidenceSource: "AI_VERIFIED",
  ...extra,
});

const confidentReading = { reading: { agreementConfidence: "high", structureConfidence: "high" } };

function seed(responses: Array<Partial<any> & { questionId: string }>, submissionStatus = "COMPLETED") {
  db = {
    submissions: [
      { id: "sub1", assessmentId: "a1", teacherId: TEACHER, status: submissionStatus, confirmedAt: null, confirmedById: null, releasedAt: null, releasedById: null },
    ],
    questions: [1, 2, 3].map((n) => ({ id: `q${n}`, assessmentId: "a1", questionNumber: n, questionText: `Question ${n}`, maximumMarks: 4 })),
    responses: responses.map((r, i) => ({
      id: `r${i + 1}`,
      submissionId: "sub1",
      status: "GRADED",
      studentAnswer: { text: "answer" },
      gradingResult: grading(3),
      annotationResult: null,
      correctionResult: confidentReading,
      ...r,
    })),
    reviewItems: [],
    events: [],
    pages: [
      { id: "p1", submissionId: "sub1", pageNumber: 1, annotatedStorageKey: "sub1/annotated-1-old.jpg" },
      { id: "p2", submissionId: "sub1", pageNumber: 2, annotatedStorageKey: null },
    ],
  };
}

const kinds = () => db.events.map((e) => e.kind);
const response = (id: string) => db.responses.find((r) => r.id === id);

beforeEach(() => {
  nextId = 100;
  seed([{ questionId: "q1" }, { questionId: "q2", gradingResult: grading(2) }, { questionId: "q3", gradingResult: grading(4) }]);
});

// ---------------------------------------------------------------------------

describe("acceptDraft", () => {
  it("marks the answer as teacher-reviewed, keeps the mark, and writes one audit event", async () => {
    const result = await acceptDraft({ teacherId: TEACHER, responseId: "r1" });

    expect(result).toEqual({ ok: true, awardedMarks: 3, changed: true });
    const stored = response("r1").gradingResult;
    expect(stored.awardedMarks).toBe(3);
    expect(stored.evidenceSource).toBe("TEACHER_REVIEWED");
    expect(stored.teacherReview).toMatchObject({ action: "CONFIRMED", reviewerId: TEACHER, reviewItemId: null, previousAwardedMarks: 3 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ kind: "TEACHER_ACCEPT", questionResponseId: "r1", submissionId: "sub1", actorId: TEACHER, marks: 3 });
  });

  it("closes review items open against that answer", async () => {
    db.reviewItems.push({ id: "i1", questionResponseId: "r1", status: "PENDING" }, { id: "i2", questionResponseId: "r2", status: "PENDING" });
    await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    expect(db.reviewItems.map((i) => i.status)).toEqual(["RESOLVED", "PENDING"]);
    expect(db.reviewItems[0].reviewerId).toBe(TEACHER);
  });

  it("is harmless to repeat: no second audit row", async () => {
    await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    const again = await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    expect(again).toEqual({ ok: true, awardedMarks: 3, changed: false });
    expect(db.events).toHaveLength(1);
  });

  it("will not accept a mark that does not exist", async () => {
    seed([{ questionId: "q1", status: "FAILED", gradingResult: null }]);
    const result = await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    expect(result).toMatchObject({ ok: false, code: "NO_DRAFT_MARK" });
    expect(db.events).toHaveLength(0);
  });

  it("does not let another teacher touch the answer", async () => {
    const result = await acceptDraft({ teacherId: OTHER_TEACHER, responseId: "r1" });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(response("r1").gradingResult.teacherReview).toBeUndefined();
    expect(db.events).toHaveLength(0);
  });

  it("refuses once the submission is confirmed", async () => {
    db.submissions[0].confirmedAt = new Date();
    const result = await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    expect(result).toMatchObject({ ok: false, code: "LOCKED" });
  });
});

describe("changeMark", () => {
  it("stores the new mark, remembers the AI's, and records who, from what and why", async () => {
    const result = await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 1.5, reason: "  missed the unit  " });

    expect(result).toEqual({ ok: true, awardedMarks: 1.5, changed: true });
    const stored = response("r1").gradingResult;
    expect(stored).toMatchObject({ awardedMarks: 1.5, outcome: "FINAL", evidenceSource: "TEACHER_REVIEWED" });
    expect(stored.teacherReview).toMatchObject({ action: "OVERRIDDEN", previousAwardedMarks: 3, previousEvidenceSource: "AI_VERIFIED" });
    expect(db.events[0]).toMatchObject({ kind: "TEACHER_CHANGE", marks: 1.5, previousMarks: 3, reason: "missed the unit", actorId: TEACHER });
  });

  it("can give a mark to an answer the AI could not mark, and makes it a graded answer", async () => {
    seed([{ questionId: "q1", status: "NEEDS_REVIEW", gradingResult: null }]);
    const result = await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 2 });
    expect(result).toMatchObject({ ok: true, awardedMarks: 2 });
    expect(response("r1").status).toBe("GRADED");
    expect(response("r1").gradingResult.teacherReview.previousAwardedMarks).toBeNull();
    expect(db.events[0].previousMarks).toBeNull();
  });

  it("stores a note for the student", async () => {
    await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 2, note: " Good method. " });
    expect(response("r1").annotationResult.teacherFeedback).toMatchObject({ note: "Good method.", reviewerId: TEACHER });
    expect(db.events[0].payload).toEqual({ note: "Good method." });
  });

  it.each([[-1], [4.5], [1.25], [Number.NaN]])("rejects %d and changes nothing", async (marks) => {
    const result = await changeMark({ teacherId: TEACHER, responseId: "r1", marks });
    expect(result).toMatchObject({ ok: false, code: "INVALID_MARKS" });
    expect(response("r1").gradingResult.awardedMarks).toBe(3);
    expect(db.events).toHaveLength(0);
  });

  it("closes the answer's open review items", async () => {
    db.reviewItems.push({ id: "i1", questionResponseId: "r1", status: "IN_REVIEW" });
    await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 2 });
    expect(db.reviewItems[0].status).toBe("RESOLVED");
  });

  it("refuses once the submission is confirmed, and for another teacher", async () => {
    expect(await changeMark({ teacherId: OTHER_TEACHER, responseId: "r1", marks: 2 })).toMatchObject({ code: "NOT_FOUND" });
    db.submissions[0].confirmedAt = new Date();
    expect(await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 2 })).toMatchObject({ code: "LOCKED" });
    expect(response("r1").gradingResult.awardedMarks).toBe(3);
    expect(db.events).toHaveLength(0);
  });
});

describe("setComment", () => {
  it("adds, edits and removes the comment, keeping the previous text in the audit row", async () => {
    await setComment({ teacherId: TEACHER, responseId: "r1", note: "First" });
    expect(response("r1").annotationResult.teacherFeedback.note).toBe("First");

    await setComment({ teacherId: TEACHER, responseId: "r1", note: "Second" });
    expect(response("r1").annotationResult.teacherFeedback.note).toBe("Second");
    expect(db.events[1].payload).toEqual({ previousNote: "First", note: "Second" });

    await setComment({ teacherId: TEACHER, responseId: "r1", note: "   " });
    expect(response("r1").annotationResult.teacherFeedback).toBeUndefined();
    expect(kinds()).toEqual(["TEACHER_COMMENT", "TEACHER_COMMENT", "TEACHER_COMMENT"]);
  });

  it("does nothing, and writes nothing, when the comment is unchanged", async () => {
    await setComment({ teacherId: TEACHER, responseId: "r1", note: "Same" });
    await setComment({ teacherId: TEACHER, responseId: "r1", note: "Same" });
    expect(db.events).toHaveLength(1);
  });

  it("refuses once confirmed", async () => {
    db.submissions[0].confirmedAt = new Date();
    expect(await setComment({ teacherId: TEACHER, responseId: "r1", note: "x" })).toMatchObject({ code: "LOCKED" });
  });
});

const FINDINGS = [
  { id: "err_0", type: "root_arithmetic_error", explanation: "Check this part.", wrongText: "120 J", correctVersion: "100" },
  { id: "err_1", type: "root_missing_step", explanation: "Not shown.", wrongText: null, correctVersion: null },
];

describe("setFindingKept — only findings a teacher keeps reach the student's copy", () => {
  beforeEach(() => {
    seed([{ questionId: "q1", correctionResult: { ...confidentReading, findings: FINDINGS } }]);
  });

  it("keeps nothing by default", async () => {
    const rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows[0].response?.findings.map((f) => [f.id, f.kept])).toEqual([["err_0", false], ["err_1", false]]);
  });

  it("keeps and removes a finding, with an audit row each time", async () => {
    expect(await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_0", kept: true })).toEqual({ ok: true });
    let rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows[0].response?.findings.map((f) => f.kept)).toEqual([true, false]);
    expect(response("r1").annotationResult.teacherFindings).toMatchObject({ keptIds: ["err_0"], reviewerId: TEACHER });

    await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_0", kept: false });
    rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows[0].response?.findings.map((f) => f.kept)).toEqual([false, false]);

    expect(db.events.map((e) => [e.kind, e.payload.findingId, e.payload.kept])).toEqual([
      ["TEACHER_FINDING", "err_0", true],
      ["TEACHER_FINDING", "err_0", false],
    ]);
  });

  it("does nothing, and writes nothing, when the choice is unchanged", async () => {
    await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_0", kept: false });
    expect(db.events).toHaveLength(0);
  });

  it("does not disturb the AI's evidence or the teacher's comment", async () => {
    await setComment({ teacherId: TEACHER, responseId: "r1", note: "Careful with units." });
    await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_1", kept: true });
    expect(response("r1").annotationResult.teacherFeedback.note).toBe("Careful with units.");
    expect(response("r1").correctionResult.findings).toEqual(FINDINGS);
  });

  it("rejects an id that is not one of this answer's findings", async () => {
    const result = await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_99", kept: true });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(response("r1").annotationResult).toBeNull();
  });

  it("refuses for another teacher and once confirmed", async () => {
    expect(await setFindingKept({ teacherId: OTHER_TEACHER, responseId: "r1", findingId: "err_0", kept: true })).toMatchObject({ code: "NOT_FOUND" });
    db.submissions[0].confirmedAt = new Date();
    expect(await setFindingKept({ teacherId: TEACHER, responseId: "r1", findingId: "err_0", kept: true })).toMatchObject({ code: "LOCKED" });
  });

  it("reports no findings for an answer that has none stored (older results)", async () => {
    seed([{ questionId: "q1" }]);
    const rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows[0].response?.findings).toEqual([]);
  });
});

describe("acceptAllSure", () => {
  it("accepts the sure answers and leaves the flagged and the unmarked ones alone", async () => {
    seed([
      { questionId: "q1" }, // sure
      { questionId: "q2", correctionResult: { reading: { agreementConfidence: "low", structureConfidence: "high" } } }, // unsure
      { questionId: "q3", status: "NEEDS_REVIEW", gradingResult: null }, // no mark
    ]);

    const result = await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });

    expect(result).toEqual({ ok: true, accepted: 1, skipped: 2 });
    expect(response("r1").gradingResult.teacherReview).toBeDefined();
    expect(response("r2").gradingResult.teacherReview).toBeUndefined();
    expect(response("r3").gradingResult).toBeNull();
  });

  it("does not count an already-reviewed answer again", async () => {
    await acceptDraft({ teacherId: TEACHER, responseId: "r1" });
    const result = await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    expect(result).toMatchObject({ accepted: 2 });
  });

  it("refuses for a confirmed submission or another teacher", async () => {
    expect(await acceptAllSure({ teacherId: OTHER_TEACHER, submissionId: "sub1" })).toMatchObject({ code: "NOT_FOUND" });
    db.submissions[0].confirmedAt = new Date();
    expect(await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" })).toMatchObject({ code: "LOCKED" });
  });
});

describe("confirmSubmission", () => {
  it("is blocked, naming every reason, until each answer has been checked", async () => {
    seed([{ questionId: "q1" }, { questionId: "q2", status: "FAILED", gradingResult: null }, { questionId: "q3" }]);
    await acceptDraft({ teacherId: TEACHER, responseId: "r1" });

    const result = await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(result).toMatchObject({ ok: false, code: "BLOCKED" });
    expect((result as any).blockers).toEqual([
      "Question 2 has no mark yet — enter one.",
      "Question 3 has not been checked yet.",
    ]);
    expect(db.submissions[0].confirmedAt).toBeNull();
    expect(db.responses).toHaveLength(3);
  });

  it("confirms once everything is checked: locks the submission, totals the marks, writes the audit row", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });

    const result = await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(result).toEqual({ ok: true, awardedMarks: 9, maximumMarks: 12, alreadyConfirmed: false });
    expect(db.submissions[0].confirmedAt).toBeInstanceOf(Date);
    expect(db.submissions[0].confirmedById).toBe(TEACHER);
    const event = db.events.find((e) => e.kind === "SUBMISSION_CONFIRMED");
    expect(event).toMatchObject({ actorId: TEACHER, marks: 9, payload: { maximumMarks: 12, answers: 3 } });
  });

  it("never releases anything to the student", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(db.submissions[0].releasedAt).toBeNull();
  });

  it("records a question the student never answered as 0, with its own audit row", async () => {
    seed([{ questionId: "q1" }, { questionId: "q2" }]); // no response for q3
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });

    const result = await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(result).toMatchObject({ ok: true, awardedMarks: 6, maximumMarks: 12 });
    const blank = db.responses.find((r) => r.questionId === "q3");
    expect(blank).toMatchObject({ status: "GRADED", studentAnswer: { text: "", notAttempted: true } });
    expect(blank.gradingResult).toMatchObject({ awardedMarks: 0, maximumMarks: 4, outcome: "FINAL", evidenceSource: "TEACHER_REVIEWED" });
    expect(db.events.find((e) => e.questionResponseId === blank.id)).toMatchObject({ kind: "TEACHER_ACCEPT", marks: 0, reason: "Not answered" });
  });

  it("will not confirm a paper that has not finished marking, even if nothing was answered", async () => {
    seed([], "PROCESSING");
    const result = await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(result).toMatchObject({ ok: false, code: "BLOCKED", blockers: ["Marking has not finished yet."] });
    expect(db.responses).toHaveLength(0);
    expect(db.submissions[0].confirmedAt).toBeNull();
  });

  it("can confirm a paper whose marking stopped and needs a teacher (NEEDS_REVIEW), once every answer is dealt with", async () => {
    seed([{ questionId: "q1" }, { questionId: "q2" }, { questionId: "q3", status: "NEEDS_REVIEW", gradingResult: null }], "NEEDS_REVIEW");
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    expect(await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" })).toMatchObject({ code: "BLOCKED" });

    await changeMark({ teacherId: TEACHER, responseId: "r3", marks: 2 });
    expect(await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" })).toMatchObject({ ok: true, awardedMarks: 8 }); // 3 + 3 drafted, 2 entered by the teacher
  });

  it("is idempotent", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    const again = await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(again).toMatchObject({ ok: true, alreadyConfirmed: true, awardedMarks: 9 });
    expect(db.events.filter((e) => e.kind === "SUBMISSION_CONFIRMED")).toHaveLength(1);
  });

  it("locks every mark change afterwards", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 0 })).toMatchObject({ code: "LOCKED" });
    expect(response("r1").gradingResult.awardedMarks).toBe(3);
  });

  it("is refused for another teacher", async () => {
    expect(await confirmSubmission({ teacherId: OTHER_TEACHER, submissionId: "sub1" })).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("releaseSubmission", () => {
  it("refuses until the marks are confirmed", async () => {
    const result = await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(result).toMatchObject({ ok: false, code: "NOT_CONFIRMED" });
    expect(db.submissions[0].releasedAt).toBeNull();
  });

  it("releases a confirmed submission, once, with an audit row", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" })).toEqual({ ok: true, alreadyReleased: false });
    expect(db.submissions[0].releasedAt).toBeInstanceOf(Date);
    expect(db.submissions[0].releasedById).toBe(TEACHER);

    expect(await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" })).toEqual({ ok: true, alreadyReleased: true });
    expect(db.events.filter((e) => e.kind === "SUBMISSION_RELEASED")).toHaveLength(1);
  });

  it("is refused for another teacher", async () => {
    db.submissions[0].confirmedAt = new Date();
    expect(await releaseSubmission({ teacherId: OTHER_TEACHER, submissionId: "sub1" })).toMatchObject({ code: "NOT_FOUND" });
    expect(db.submissions[0].releasedAt).toBeNull();
  });

  it("clears any marked-up copy drawn before the teacher settled the marks, in the same step as the release", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(db.pages[0].annotatedStorageKey).not.toBeNull();

    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(db.pages.map((p) => p.annotatedStorageKey)).toEqual([null, null]);
  });

  it("deletes the files of the copies it cleared, so none are left behind on disk", async () => {
    removedFiles.length = 0;
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    const before = db.pages.map((p) => p.annotatedStorageKey).filter(Boolean);
    expect(before.length).toBeGreaterThan(0);

    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(removedFiles.sort()).toEqual([...before].sort());
  });

  it("deletes nothing when the release is refused", async () => {
    removedFiles.length = 0;
    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(removedFiles).toEqual([]);
  });

  it("leaves a marked-up copy alone when the release is refused", async () => {
    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    expect(db.pages[0].annotatedStorageKey).toBe("sub1/annotated-1-old.jpg");
  });
});

describe("reopenSubmission", () => {
  it("takes a released submission back: the student loses access and marks can change again", async () => {
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(await reopenSubmission({ teacherId: TEACHER, submissionId: "sub1", reason: " parent query " })).toEqual({ ok: true });

    expect(db.submissions[0]).toMatchObject({ confirmedAt: null, releasedAt: null, confirmedById: null, releasedById: null });
    const event = db.events.find((e) => e.kind === "SUBMISSION_REOPENED");
    expect(event).toMatchObject({ reason: "parent query", payload: { wasReleased: true } });
    expect(await changeMark({ teacherId: TEACHER, responseId: "r1", marks: 2 })).toMatchObject({ ok: true });
  });

  it("does nothing, and writes nothing, for a submission that was never confirmed", async () => {
    expect(await reopenSubmission({ teacherId: TEACHER, submissionId: "sub1" })).toEqual({ ok: true });
    expect(db.events).toHaveLength(0);
  });
});

describe("the audit trail", () => {
  it("tells the whole story of a submission, in order", async () => {
    await changeMark({ teacherId: TEACHER, responseId: "r2", marks: 1, reason: "no working" });
    await setComment({ teacherId: TEACHER, responseId: "r2", note: "Show your steps." });
    await acceptAllSure({ teacherId: TEACHER, submissionId: "sub1" });
    await confirmSubmission({ teacherId: TEACHER, submissionId: "sub1" });
    await releaseSubmission({ teacherId: TEACHER, submissionId: "sub1" });

    expect(kinds()).toEqual([
      "TEACHER_CHANGE",
      "TEACHER_COMMENT",
      "TEACHER_ACCEPT",
      "TEACHER_ACCEPT",
      "SUBMISSION_CONFIRMED",
      "SUBMISSION_RELEASED",
    ]);
    expect(db.events.every((e) => e.submissionId === "sub1" && e.actorId === TEACHER)).toBe(true);
  });
});

describe("loadSubmissionReview", () => {
  it("lists every question, with unanswered ones as having no response", async () => {
    seed([{ questionId: "q1" }]);
    const rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows.map((r) => [r.questionNumber, r.response === null])).toEqual([[1, false], [2, true], [3, true]]);
    expect(rows[0].attention.level).toBe("SURE");
  });

  it("reports open flags as reasons", async () => {
    db.reviewItems.push({ id: "i1", questionResponseId: "r1", status: "PENDING", reason: "NOVEL_APPROACH" });
    const rows = await loadSubmissionReview(fake, "sub1", "a1");
    expect(rows[0].attention.level).toBe("UNSURE");
  });
});
