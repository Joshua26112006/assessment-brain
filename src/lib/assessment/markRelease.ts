import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseAnnotationResult, parseGradingResult } from "@/lib/pipeline/parseResults";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import { recalculateSubmissionStatus } from "@/lib/assessment/submissionStatusSync";
import { withTeacherFeedback } from "@/lib/assessment/reviewResolution";
import {
  classifyAnswer,
  confirmationBlockers,
  roundMarks,
  validateTeacherMark,
  type AnswerAttention,
} from "@/lib/assessment/markReview";
import { ACTIONABLE_REVIEW_STATUSES } from "@/lib/review-scope";
import { REVIEW_DECISION_CONTRACT_VERSION, type ReviewDecisionRecord } from "@/types/review";
import type { GradingResult } from "@/types/pipeline";
import type { StoredFinding } from "@/types/structuredCorrection";

/**
 * Everything a teacher does to a submission's marks between "the AI drafted
 * them" and "the student can see them" (decision D1 of
 * 06-correction-hardening-plan.md): accept or change an answer's mark, write a
 * comment, confirm the whole submission, release it, or take it back.
 *
 * Rules that hold for every function here:
 *  - Ownership is checked in the query itself, never trusted from the caller.
 *  - A confirmed submission is locked. Marks change again only after it is
 *    reopened, so a confirmation always describes exactly what is stored.
 *  - Each change and its audit row (MarkEvent) are written in ONE transaction:
 *    a mark can never change without a record of who changed it and from what.
 *  - Nothing reaches a student here. Only releaseSubmission sets releasedAt,
 *    which src/lib/release.ts is the sole reader of.
 */

type Tx = Prisma.TransactionClient;

export type MarkActionFailureCode =
  | "NOT_FOUND"
  | "LOCKED"
  | "NO_DRAFT_MARK"
  | "INVALID_MARKS"
  | "BLOCKED"
  | "NOT_CONFIRMED";

export interface MarkActionFailure {
  ok: false;
  code: MarkActionFailureCode;
  message: string;
  /** For BLOCKED: every reason the submission cannot be confirmed yet. */
  blockers?: string[];
}

/** Submission statuses meaning the pipeline has stopped working on it (finished, or stopped and needing a teacher). */
const MARKING_FINISHED_STATUSES = new Set(["COMPLETED", "NEEDS_REVIEW", "FAILED"]);

const LOCKED_MESSAGE = "This submission has been confirmed. Reopen it to change marks.";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface ReviewAnswerRow {
  questionId: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  /** Null when the student has no response row for this question. */
  response: {
    id: string;
    status: string;
    studentAnswerText: string;
    gradingResult: unknown;
    annotationResult: unknown;
    correctionResult: unknown;
    awardedMarks: number | null;
    /** Pages the answer was read from, used to place the marks on the right page. */
    sourcePages: number[];
    /** The AI's suggested findings, each marked kept or not by the teacher (none are kept until they say so). */
    findings: Array<StoredFinding & { kept: boolean }>;
  } | null;
  attention: AnswerAttention;
}

/** Findings stored with a response's correction, or none for an older or non-structured result. */
export function storedFindingsOf(correctionResult: unknown): StoredFinding[] {
  if (typeof correctionResult !== "object" || correctionResult === null) return [];
  const list = (correctionResult as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is StoredFinding =>
      typeof item === "object" && item !== null && typeof (item as StoredFinding).id === "string" &&
      typeof (item as StoredFinding).explanation === "string",
  );
}

function keptFindingIds(annotationResult: unknown): Set<string> {
  const kept = parseAnnotationResult(annotationResult)?.teacherFindings?.keptIds;
  return new Set(Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string") : []);
}

function sourcePagesOf(studentAnswer: unknown): number[] {
  if (typeof studentAnswer !== "object" || studentAnswer === null) return [];
  const pages = (studentAnswer as { sourcePages?: unknown }).sourcePages;
  return Array.isArray(pages) ? pages.filter((page): page is number => typeof page === "number") : [];
}

function studentAnswerText(studentAnswer: unknown): string {
  if (typeof studentAnswer === "object" && studentAnswer !== null && "text" in studentAnswer) {
    const text = (studentAnswer as { text: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function readingOf(correctionResult: unknown): { agreementConfidence?: unknown; structureConfidence?: unknown } | null {
  if (typeof correctionResult !== "object" || correctionResult === null) return null;
  const reading = (correctionResult as { reading?: unknown }).reading;
  return typeof reading === "object" && reading !== null ? (reading as { agreementConfidence?: unknown }) : null;
}

/** Every question of the assessment with its response and how much attention that answer needs. */
export async function loadSubmissionReview(
  db: Tx | typeof prisma,
  submissionId: string,
  assessmentId: string,
): Promise<ReviewAnswerRow[]> {
  const [questions, responses] = await Promise.all([
    db.question.findMany({
      where: { assessmentId },
      orderBy: { questionNumber: "asc" },
      select: { id: true, questionNumber: true, questionText: true, maximumMarks: true },
    }),
    db.questionResponse.findMany({
      where: { submissionId },
      select: {
        id: true,
        questionId: true,
        status: true,
        studentAnswer: true,
        gradingResult: true,
        annotationResult: true,
        correctionResult: true,
        reviewItems: {
          where: { status: { in: [...ACTIONABLE_REVIEW_STATUSES] } },
          select: { reason: true },
        },
      },
    }),
  ]);

  const byQuestion = new Map(responses.map((response) => [response.questionId, response]));

  return questions.map((question): ReviewAnswerRow => {
    const response = byQuestion.get(question.id) ?? null;
    const base = {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionText: question.questionText,
      maximumMarks: Number(question.maximumMarks),
    };

    if (!response) {
      return {
        ...base,
        response: null,
        attention: { level: "SURE", reasons: [], needsMark: false, reviewed: false },
      };
    }

    const attention = classifyAnswer({
      responseStatus: response.status,
      gradingResult: response.gradingResult,
      reading: readingOf(response.correctionResult),
      mappingUncertain:
        typeof response.studentAnswer === "object" &&
        response.studentAnswer !== null &&
        (response.studentAnswer as { uncertain?: unknown }).uncertain === true,
      openReviewReasons: response.reviewItems.map((item) => item.reason),
    });

    return {
      ...base,
      response: {
        id: response.id,
        status: response.status,
        studentAnswerText: studentAnswerText(response.studentAnswer),
        gradingResult: response.gradingResult,
        annotationResult: response.annotationResult,
        correctionResult: response.correctionResult,
        awardedMarks: parseGradingResult(response.gradingResult)?.awardedMarks ?? null,
        sourcePages: sourcePagesOf(response.studentAnswer),
        findings: (() => {
          const kept = keptFindingIds(response.annotationResult);
          return storedFindingsOf(response.correctionResult).map((finding) => ({ ...finding, kept: kept.has(finding.id) }));
        })(),
      },
      attention,
    };
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function writeMarkEvent(
  tx: Tx,
  event: {
    kind:
      | "TEACHER_ACCEPT"
      | "TEACHER_CHANGE"
      | "TEACHER_COMMENT"
      | "TEACHER_FINDING"
      | "SUBMISSION_CONFIRMED"
      | "SUBMISSION_RELEASED"
      | "SUBMISSION_REOPENED";
    submissionId: string;
    questionResponseId?: string | null;
    marks?: number | null;
    previousMarks?: number | null;
    actorId: string;
    reason?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.markEvent.create({
    data: {
      kind: event.kind,
      submissionId: event.submissionId,
      questionResponseId: event.questionResponseId ?? null,
      marks: event.marks ?? null,
      previousMarks: event.previousMarks ?? null,
      actorId: event.actorId,
      reason: event.reason?.trim() ? event.reason.trim() : null,
      payload: (event.payload as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
}

/** Flags raised against this answer are the teacher's to settle by deciding its mark, so they are closed with it. */
async function closeOpenReviewItems(
  tx: Tx,
  input: { responseId: string; teacherId: string; decidedAt: string; action: ReviewDecisionRecord["action"]; marks: number; previousMarks: number | null; feedbackNote: string | null },
): Promise<void> {
  const decision: ReviewDecisionRecord = {
    contractVersion: REVIEW_DECISION_CONTRACT_VERSION,
    action: input.action,
    decidedAt: input.decidedAt,
    reviewerId: input.teacherId,
    questionResponseId: input.responseId,
    awardedMarks: input.marks,
    previousAwardedMarks: input.previousMarks,
    previousOutcome: null,
    previousEvidenceSource: null,
    feedbackNote: input.feedbackNote,
  };
  await tx.reviewItem.updateMany({
    where: { questionResponseId: input.responseId, status: { in: [...ACTIONABLE_REVIEW_STATUSES] } },
    data: { status: "RESOLVED", reviewerId: input.teacherId, decision: decision as unknown as object },
  });
}

async function loadOwnedResponse(tx: Tx, responseId: string, teacherId: string) {
  return tx.questionResponse.findFirst({
    where: { id: responseId, submission: { assessment: { teacherId } } },
    select: {
      id: true,
      status: true,
      submissionId: true,
      gradingResult: true,
      annotationResult: true,
      question: { select: { maximumMarks: true } },
      submission: { select: { confirmedAt: true } },
    },
  });
}

const notFound = (): MarkActionFailure => ({ ok: false, code: "NOT_FOUND", message: "Answer not found." });
const locked = (): MarkActionFailure => ({ ok: false, code: "LOCKED", message: LOCKED_MESSAGE });

// ---------------------------------------------------------------------------
// Per-answer actions
// ---------------------------------------------------------------------------

export type AnswerActionResult = { ok: true; awardedMarks: number; changed: boolean } | MarkActionFailure;

/** The teacher agrees with the mark the AI drafted. */
export async function acceptDraft(input: { teacherId: string; responseId: string }): Promise<AnswerActionResult> {
  return prisma.$transaction(async (tx): Promise<AnswerActionResult> => {
    const response = await loadOwnedResponse(tx, input.responseId, input.teacherId);
    if (!response) return notFound();
    if (response.submission.confirmedAt) return locked();

    const previous = parseGradingResult(response.gradingResult);
    if (response.status !== "GRADED" || !previous || previous.outcome !== "FINAL") {
      return {
        ok: false,
        code: "NO_DRAFT_MARK",
        message: "There is no draft mark to accept for this answer — enter a mark instead.",
      };
    }

    // Accepting twice is harmless and leaves one audit row, not two.
    if (previous.teacherReview) return { ok: true, awardedMarks: previous.awardedMarks, changed: false };

    const decidedAt = new Date().toISOString();
    const next: GradingResult = {
      ...previous,
      outcome: "FINAL",
      evidenceSource: "TEACHER_REVIEWED",
      teacherReview: {
        action: "CONFIRMED",
        reviewedAt: decidedAt,
        reviewerId: input.teacherId,
        reviewItemId: null,
        previousAwardedMarks: previous.awardedMarks,
        previousOutcome: previous.outcome,
        previousEvidenceSource: previous.evidenceSource ?? null,
      },
    };

    const updated = await tx.questionResponse.updateMany({
      where: { id: response.id, submission: { confirmedAt: null } },
      data: { gradingResult: next as unknown as object },
    });
    if (updated.count === 0) return locked();

    await closeOpenReviewItems(tx, {
      responseId: response.id,
      teacherId: input.teacherId,
      decidedAt,
      action: "CONFIRMED",
      marks: previous.awardedMarks,
      previousMarks: previous.awardedMarks,
      feedbackNote: null,
    });
    await writeMarkEvent(tx, {
      kind: "TEACHER_ACCEPT",
      submissionId: response.submissionId,
      questionResponseId: response.id,
      marks: previous.awardedMarks,
      previousMarks: previous.awardedMarks,
      actorId: input.teacherId,
    });
    await recalculateSubmissionStatus(tx, response.submissionId);

    return { ok: true, awardedMarks: previous.awardedMarks, changed: true };
  });
}

/** The teacher replaces the mark. Works whether or not the AI produced one. */
export async function changeMark(input: {
  teacherId: string;
  responseId: string;
  marks: number;
  /** Why, in the teacher's words. Recorded when given; not required. */
  reason?: string | null;
  /** A note for the student, written alongside the new mark. */
  note?: string | null;
}): Promise<AnswerActionResult> {
  return prisma.$transaction(async (tx): Promise<AnswerActionResult> => {
    const response = await loadOwnedResponse(tx, input.responseId, input.teacherId);
    if (!response) return notFound();
    if (response.submission.confirmedAt) return locked();

    const maximumMarks = Number(response.question.maximumMarks);
    const valid = validateTeacherMark(input.marks, maximumMarks);
    if (!valid.ok) return { ok: false, code: "INVALID_MARKS", message: valid.message };

    const previous = parseGradingResult(response.gradingResult);
    const decidedAt = new Date().toISOString();
    const trimmedNote = input.note?.trim() ?? "";
    const note = trimmedNote.length > 0 ? trimmedNote : null;

    const base: GradingResult =
      previous ??
      ({
        ...stageResultBase("GRADING", [
          "No pipeline grading result existed for this response; this record was created by teacher review.",
        ]),
        awardedMarks: valid.marks,
        maximumMarks,
        outcome: "FINAL",
        evidenceSource: "TEACHER_REVIEWED",
      } satisfies GradingResult);

    const next: GradingResult = {
      ...base,
      awardedMarks: valid.marks,
      maximumMarks,
      outcome: "FINAL",
      evidenceSource: "TEACHER_REVIEWED",
      teacherReview: {
        action: "OVERRIDDEN",
        reviewedAt: decidedAt,
        reviewerId: input.teacherId,
        reviewItemId: null,
        previousAwardedMarks: previous?.awardedMarks ?? null,
        previousOutcome: previous?.outcome ?? null,
        previousEvidenceSource: previous?.evidenceSource ?? null,
      },
    };

    const nextAnnotation = note
      ? withTeacherFeedback(response.annotationResult, {
          note,
          authoredAt: decidedAt,
          reviewerId: input.teacherId,
          reviewItemId: null,
        })
      : null;

    const updated = await tx.questionResponse.updateMany({
      where: { id: response.id, submission: { confirmedAt: null } },
      data: {
        status: "GRADED",
        gradingResult: next as unknown as object,
        ...(nextAnnotation ? { annotationResult: nextAnnotation as unknown as object } : {}),
      },
    });
    if (updated.count === 0) return locked();

    await closeOpenReviewItems(tx, {
      responseId: response.id,
      teacherId: input.teacherId,
      decidedAt,
      action: "OVERRIDDEN",
      marks: valid.marks,
      previousMarks: previous?.awardedMarks ?? null,
      feedbackNote: note,
    });
    await writeMarkEvent(tx, {
      kind: "TEACHER_CHANGE",
      submissionId: response.submissionId,
      questionResponseId: response.id,
      marks: valid.marks,
      previousMarks: previous?.awardedMarks ?? null,
      actorId: input.teacherId,
      reason: input.reason,
      payload: { note },
    });
    await recalculateSubmissionStatus(tx, response.submissionId);

    return { ok: true, awardedMarks: valid.marks, changed: true };
  });
}

/** Sets, edits or (with an empty note) removes the comment the student will see on an answer. */
export async function setComment(input: {
  teacherId: string;
  responseId: string;
  note: string;
}): Promise<{ ok: true } | MarkActionFailure> {
  return prisma.$transaction(async (tx): Promise<{ ok: true } | MarkActionFailure> => {
    const response = await loadOwnedResponse(tx, input.responseId, input.teacherId);
    if (!response) return notFound();
    if (response.submission.confirmedAt) return locked();

    const note = input.note.trim();
    const existing = parseAnnotationResult(response.annotationResult);
    const previousNote = existing?.teacherFeedback?.note ?? null;
    if ((note || null) === previousNote) return { ok: true };

    const now = new Date().toISOString();
    let nextAnnotation: Prisma.InputJsonValue;
    if (note) {
      nextAnnotation = withTeacherFeedback(response.annotationResult, {
        note,
        authoredAt: now,
        reviewerId: input.teacherId,
        reviewItemId: null,
      }) as unknown as Prisma.InputJsonValue;
    } else if (existing) {
      const { teacherFeedback: _removed, ...rest } = existing;
      void _removed;
      nextAnnotation = rest as unknown as Prisma.InputJsonValue;
    } else {
      return { ok: true };
    }

    const updated = await tx.questionResponse.updateMany({
      where: { id: response.id, submission: { confirmedAt: null } },
      data: { annotationResult: nextAnnotation },
    });
    if (updated.count === 0) return locked();

    await writeMarkEvent(tx, {
      kind: "TEACHER_COMMENT",
      submissionId: response.submissionId,
      questionResponseId: response.id,
      actorId: input.teacherId,
      payload: { previousNote, note: note || null },
    });
    return { ok: true };
  });
}

/**
 * Keeps or removes one of the AI's suggested findings (decision D5). Only kept
 * findings are drawn on the student's marked copy; none is kept by default.
 */
export async function setFindingKept(input: {
  teacherId: string;
  responseId: string;
  findingId: string;
  kept: boolean;
}): Promise<{ ok: true } | MarkActionFailure> {
  return prisma.$transaction(async (tx): Promise<{ ok: true } | MarkActionFailure> => {
    const response = await tx.questionResponse.findFirst({
      where: { id: input.responseId, submission: { assessment: { teacherId: input.teacherId } } },
      select: {
        id: true,
        submissionId: true,
        annotationResult: true,
        correctionResult: true,
        submission: { select: { confirmedAt: true } },
      },
    });
    if (!response) return notFound();
    if (response.submission.confirmedAt) return locked();

    // The id must be one of this answer's own findings: a forged id cannot add anything.
    const finding = storedFindingsOf(response.correctionResult).find((candidate) => candidate.id === input.findingId);
    if (!finding) return { ok: false, code: "NOT_FOUND", message: "Finding not found." };

    const kept = keptFindingIds(response.annotationResult);
    if (kept.has(finding.id) === input.kept) return { ok: true };
    if (input.kept) kept.add(finding.id);
    else kept.delete(finding.id);

    const decidedAt = new Date().toISOString();
    const parsed = parseAnnotationResult(response.annotationResult);
    const base =
      parsed ??
      ({
        ...stageResultBase("ANNOTATION", ["No pipeline annotation existed for this response; this record was created by teacher review."]),
        entries: [],
        needsHumanReview: false,
      } as const);
    const next = { ...base, teacherFindings: { keptIds: [...kept], decidedAt, reviewerId: input.teacherId } };

    const updated = await tx.questionResponse.updateMany({
      where: { id: response.id, submission: { confirmedAt: null } },
      data: { annotationResult: next as unknown as object },
    });
    if (updated.count === 0) return locked();

    await writeMarkEvent(tx, {
      kind: "TEACHER_FINDING",
      submissionId: response.submissionId,
      questionResponseId: response.id,
      actorId: input.teacherId,
      payload: { findingId: finding.id, kept: input.kept, type: finding.type, wrongText: finding.wrongText },
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Whole-submission actions
// ---------------------------------------------------------------------------

async function loadOwnedSubmission(tx: Tx, submissionId: string, teacherId: string) {
  return tx.submission.findFirst({
    where: { id: submissionId, assessment: { teacherId } },
    select: { id: true, status: true, assessmentId: true, confirmedAt: true, releasedAt: true },
  });
}

/** Accepts every answer that is sure, mark-bearing and not yet reviewed. Flagged answers are never touched. */
export async function acceptAllSure(input: {
  teacherId: string;
  submissionId: string;
}): Promise<{ ok: true; accepted: number; skipped: number } | MarkActionFailure> {
  const submission = await loadOwnedSubmission(prisma, input.submissionId, input.teacherId);
  if (!submission) return notFound();
  if (submission.confirmedAt) return locked();

  const rows = await loadSubmissionReview(prisma, submission.id, submission.assessmentId);
  let accepted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.response) continue;
    if (row.attention.reviewed) continue;
    if (row.attention.level !== "SURE") {
      skipped++;
      continue;
    }
    const result = await acceptDraft({ teacherId: input.teacherId, responseId: row.response.id });
    if (result.ok && result.changed) accepted++;
    else if (!result.ok) skipped++;
  }
  return { ok: true, accepted, skipped };
}

export type ConfirmResult =
  | { ok: true; awardedMarks: number; maximumMarks: number; alreadyConfirmed: boolean }
  | MarkActionFailure;

/**
 * Locks a submission's marks once the teacher has dealt with every answer.
 * Questions the student never answered are recorded as 0 here, in the same
 * transaction, so the confirmed set always covers the whole paper.
 */
export async function confirmSubmission(input: { teacherId: string; submissionId: string }): Promise<ConfirmResult> {
  return prisma.$transaction(async (tx): Promise<ConfirmResult> => {
    const submission = await loadOwnedSubmission(tx, input.submissionId, input.teacherId);
    if (!submission) return notFound();

    const rows = await loadSubmissionReview(tx, submission.id, submission.assessmentId);
    const total = (list: ReviewAnswerRow[]) => ({
      awarded: roundMarks(list.reduce((sum, row) => sum + (row.response?.awardedMarks ?? 0), 0)),
      maximum: roundMarks(list.reduce((sum, row) => sum + row.maximumMarks, 0)),
    });

    if (submission.confirmedAt) {
      const { awarded, maximum } = total(rows);
      return { ok: true, awardedMarks: awarded, maximumMarks: maximum, alreadyConfirmed: true };
    }

    // Until marking has finished there may be no responses yet, and "nothing
    // answered" would otherwise confirm a whole paper as 0.
    if (!MARKING_FINISHED_STATUSES.has(submission.status)) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "This submission is still being marked. Confirm it once marking has finished.",
        blockers: ["Marking has not finished yet."],
      };
    }

    const blockers = confirmationBlockers(
      rows.map((row) => ({
        questionNumber: row.questionNumber,
        needsMark: row.attention.needsMark,
        reviewed: row.attention.reviewed,
        notAnswered: row.response === null,
      })),
    );
    if (blockers.length > 0) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "Some answers still need your attention before the marks can be confirmed.",
        blockers,
      };
    }

    const decidedAt = new Date().toISOString();
    for (const row of rows.filter((entry) => entry.response === null)) {
      const created = await tx.questionResponse.create({
        data: {
          submissionId: submission.id,
          questionId: row.questionId,
          status: "GRADED",
          studentAnswer: { text: "", notAttempted: true },
          gradingResult: {
            ...stageResultBase("GRADING", ["The student did not answer this question; recorded as 0 when marks were confirmed."]),
            awardedMarks: 0,
            maximumMarks: row.maximumMarks,
            outcome: "FINAL",
            evidenceSource: "TEACHER_REVIEWED",
            teacherReview: {
              action: "CONFIRMED",
              reviewedAt: decidedAt,
              reviewerId: input.teacherId,
              reviewItemId: null,
              previousAwardedMarks: null,
              previousOutcome: null,
              previousEvidenceSource: null,
            },
          } as unknown as object,
        },
        select: { id: true },
      });
      await writeMarkEvent(tx, {
        kind: "TEACHER_ACCEPT",
        submissionId: submission.id,
        questionResponseId: created.id,
        marks: 0,
        previousMarks: null,
        actorId: input.teacherId,
        reason: "Not answered",
      });
    }

    await recalculateSubmissionStatus(tx, submission.id);

    const lockedNow = await tx.submission.updateMany({
      where: { id: submission.id, confirmedAt: null },
      data: { confirmedAt: new Date(decidedAt), confirmedById: input.teacherId },
    });
    if (lockedNow.count === 0) {
      // A concurrent confirmation won; nothing more to do.
      const { awarded, maximum } = total(rows);
      return { ok: true, awardedMarks: awarded, maximumMarks: maximum, alreadyConfirmed: true };
    }

    const finalRows = await loadSubmissionReview(tx, submission.id, submission.assessmentId);
    const { awarded, maximum } = total(finalRows);
    await writeMarkEvent(tx, {
      kind: "SUBMISSION_CONFIRMED",
      submissionId: submission.id,
      actorId: input.teacherId,
      marks: awarded,
      payload: { maximumMarks: maximum, answers: finalRows.length },
    });
    return { ok: true, awardedMarks: awarded, maximumMarks: maximum, alreadyConfirmed: false };
  });
}

export type ReleaseResult = { ok: true; alreadyReleased: boolean } | MarkActionFailure;

/** Lets the student see this submission's marks, feedback and marked-up pages. Only ever after confirmation. */
export async function releaseSubmission(input: { teacherId: string; submissionId: string }): Promise<ReleaseResult> {
  return prisma.$transaction(async (tx): Promise<ReleaseResult> => {
    const submission = await loadOwnedSubmission(tx, input.submissionId, input.teacherId);
    if (!submission) return notFound();
    if (!submission.confirmedAt) {
      return { ok: false, code: "NOT_CONFIRMED", message: "Confirm the marks before releasing them to the student." };
    }
    if (submission.releasedAt) return { ok: true, alreadyReleased: true };

    const updated = await tx.submission.updateMany({
      where: { id: submission.id, confirmedAt: { not: null }, releasedAt: null },
      data: { releasedAt: new Date(), releasedById: input.teacherId },
    });
    if (updated.count === 0) return { ok: true, alreadyReleased: true };

    // Any marked-up copy that exists now was drawn before the teacher settled
    // the marks. It is cleared in the same transaction as the release, so there
    // is no moment at which a student could be shown it; a fresh one is drawn
    // from the final marks straight afterwards (markedCopy.ts).
    await tx.answerSheetPage.updateMany({
      where: { submissionId: submission.id, annotatedStorageKey: { not: null } },
      data: { annotatedStorageKey: null },
    });

    await writeMarkEvent(tx, { kind: "SUBMISSION_RELEASED", submissionId: submission.id, actorId: input.teacherId });
    return { ok: true, alreadyReleased: false };
  });
}

/** Takes a confirmed or released submission back to the teacher so its marks can change. The student stops seeing them at once. */
export async function reopenSubmission(input: {
  teacherId: string;
  submissionId: string;
  reason?: string | null;
}): Promise<{ ok: true } | MarkActionFailure> {
  return prisma.$transaction(async (tx): Promise<{ ok: true } | MarkActionFailure> => {
    const submission = await loadOwnedSubmission(tx, input.submissionId, input.teacherId);
    if (!submission) return notFound();
    if (!submission.confirmedAt && !submission.releasedAt) return { ok: true };

    await tx.submission.update({
      where: { id: submission.id },
      data: { confirmedAt: null, confirmedById: null, releasedAt: null, releasedById: null },
    });
    await writeMarkEvent(tx, {
      kind: "SUBMISSION_REOPENED",
      submissionId: submission.id,
      actorId: input.teacherId,
      reason: input.reason,
      payload: { wasReleased: Boolean(submission.releasedAt) },
    });
    return { ok: true };
  });
}

export type { AnswerAttention };
