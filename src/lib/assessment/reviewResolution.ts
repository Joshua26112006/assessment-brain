import { prisma } from "@/lib/prisma";
import { parseAnnotationResult, parseGradingResult } from "@/lib/pipeline/parseResults";
import { stageResultBase } from "@/lib/pipeline/stageResult";
import { recalculateSubmissionStatus } from "@/lib/assessment/submissionStatusSync";
import {
  ACTIONABLE_REVIEW_STATUSES,
  isActionableReviewStatus,
  reviewItemOwnedByTeacher,
} from "@/lib/review-scope";
import { REVIEW_DECISION_CONTRACT_VERSION, type ReviewDecisionRecord } from "@/types/review";
import type { AnnotationResult, GradingResult, TeacherFeedbackNote } from "@/types/pipeline";

/**
 * The single place a human review decision is applied.
 *
 * Everything the teacher can do to a flagged response funnels through here
 * so that the four things that must move together — the ReviewItem's
 * lifecycle, the QuestionResponse's status, its grading record, and the
 * parent Submission's aggregate status — can never end up half-applied or
 * mutually contradictory. The whole resolution runs in one transaction, and
 * the ReviewItem itself is the concurrency guard (see `claim` below).
 *
 * Deliberately does NOT re-run or second-guess the pipeline: the AI's
 * correction evidence (checkpoints, independent evaluation, comparison,
 * verification) in `correctionResult` is never rewritten, and the pinned
 * `rubricVersionUsedId` is never touched. Human review supersedes the
 * pipeline's *conclusion*, not its record of how it got there.
 */

export type ReviewResolutionAction = "CONFIRM" | "OVERRIDE" | "DISMISS";

export interface ResolveReviewItemInput {
  reviewItemId: string;
  /** From the authenticated session — never from client input. */
  teacherId: string;
  action: ReviewResolutionAction;
  /** Required for OVERRIDE. Validated here regardless of what the caller already checked. */
  overrideMarks?: number | null;
  /** Optional student-facing note; already trimmed by the caller. */
  feedbackNote?: string | null;
}

export type ResolveReviewItemFailureCode =
  | "NOT_FOUND"
  | "ALREADY_RESOLVED"
  | "NO_QUESTION_RESPONSE"
  | "NO_GRADING_RESULT"
  | "INVALID_MARKS"
  | "CANNOT_DISMISS";

export type ResolveReviewItemResult =
  | {
      ok: true;
      action: ReviewDecisionRecord["action"];
      awardedMarks: number | null;
      questionResponseStatus: "GRADED" | null;
      submissionStatus: "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED" | null;
      assessmentId: string | null;
      submissionId: string | null;
    }
  | { ok: false; code: ResolveReviewItemFailureCode; message: string };

/** Statuses in which a response is still waiting on a mark, so a flag can't just be dismissed. */
const AWAITING_MARK_STATUSES = new Set([
  "PENDING",
  "ANSWER_EXTRACTED",
  "CORRECTING",
  "CORRECTED",
  "ANNOTATING",
  "ANNOTATED",
  "GRADING",
  "NEEDS_REVIEW",
  "FAILED",
]);

/**
 * Whether a response still needs a mark decided. Dismissing a flag on such a
 * response would strand the student with no path to a result, so it's only
 * ever resolvable by confirming or overriding. Exported so the review page
 * offers exactly the actions the server will actually accept.
 */
export function isAwaitingMark(questionResponseStatus: string): boolean {
  return AWAITING_MARK_STATUSES.has(questionResponseStatus);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function resolveReviewItem(
  input: ResolveReviewItemInput,
): Promise<ResolveReviewItemResult> {
  const { reviewItemId, teacherId, action } = input;

  // Ownership is re-verified here, independently of whatever page or action
  // called in: this query only ever matches a review item reachable from an
  // assessment this teacher owns.
  const item = await prisma.reviewItem.findFirst({
    where: { id: reviewItemId, ...reviewItemOwnedByTeacher(teacherId) },
    select: {
      id: true,
      status: true,
      questionResponseId: true,
      questionResponse: {
        select: {
          id: true,
          status: true,
          submissionId: true,
          gradingResult: true,
          annotationResult: true,
          question: { select: { id: true, assessmentId: true, maximumMarks: true } },
        },
      },
    },
  });

  if (!item) {
    return { ok: false, code: "NOT_FOUND", message: "Review item not found." };
  }

  if (!isActionableReviewStatus(item.status)) {
    return {
      ok: false,
      code: "ALREADY_RESOLVED",
      message: "This review item has already been resolved.",
    };
  }

  const response = item.questionResponse;
  const decidedAt = new Date().toISOString();

  const trimmedNote = input.feedbackNote?.trim() ?? "";
  const feedbackNote = trimmedNote.length > 0 ? trimmedNote : null;

  // --- DISMISS: acknowledge the flag, change no marks. ---
  if (action === "DISMISS") {
    if (response && AWAITING_MARK_STATUSES.has(response.status)) {
      return {
        ok: false,
        code: "CANNOT_DISMISS",
        message:
          "This response is still waiting on a mark — confirm the evaluation or enter a mark instead of dismissing it.",
      };
    }

    const decision: ReviewDecisionRecord = {
      contractVersion: REVIEW_DECISION_CONTRACT_VERSION,
      action: "DISMISSED",
      decidedAt,
      reviewerId: teacherId,
      questionResponseId: item.questionResponseId,
      awardedMarks: null,
      previousAwardedMarks: null,
      previousOutcome: null,
      previousEvidenceSource: null,
      feedbackNote,
    };

    return prisma.$transaction(async (tx) => {
      const claimed = await tx.reviewItem.updateMany({
        where: { id: item.id, status: { in: [...ACTIONABLE_REVIEW_STATUSES] } },
        data: { status: "DISMISSED", reviewerId: teacherId, decision: decision as unknown as object },
      });
      if (claimed.count === 0) {
        return {
          ok: false as const,
          code: "ALREADY_RESOLVED" as const,
          message: "This review item has already been resolved.",
        };
      }

      // A dismissal never changes the mark, but a note the teacher wrote
      // alongside it is still meant for the student.
      if (response && feedbackNote) {
        const annotation = withTeacherFeedback(response.annotationResult, {
          note: feedbackNote,
          authoredAt: decidedAt,
          reviewerId: teacherId,
          reviewItemId: item.id,
        });
        await tx.questionResponse.update({
          where: { id: response.id },
          data: { annotationResult: annotation as unknown as object },
        });
      }

      return {
        ok: true as const,
        action: "DISMISSED" as const,
        awardedMarks: null,
        questionResponseStatus: null,
        submissionStatus: null,
        assessmentId: response?.question.assessmentId ?? null,
        submissionId: response?.submissionId ?? null,
      };
    });
  }

  // --- CONFIRM / OVERRIDE both settle the response's final mark. ---
  if (!response) {
    return {
      ok: false,
      code: "NO_QUESTION_RESPONSE",
      message: "This review item isn't linked to a student response, so it can't be marked.",
    };
  }

  const questionMaximumMarks = Number(response.question.maximumMarks);
  const previous = parseGradingResult(response.gradingResult);

  let awardedMarks: number;
  let nextGrading: GradingResult;

  if (action === "CONFIRM") {
    if (!previous) {
      return {
        ok: false,
        code: "NO_GRADING_RESULT",
        message:
          "There's no completed evaluation to confirm for this response — enter a mark instead.",
      };
    }

    awardedMarks = previous.awardedMarks;
    nextGrading = {
      ...previous,
      outcome: "FINAL",
      evidenceSource: "TEACHER_REVIEWED",
      teacherReview: {
        action: "CONFIRMED",
        reviewedAt: decidedAt,
        reviewerId: teacherId,
        reviewItemId: item.id,
        previousAwardedMarks: previous.awardedMarks,
        previousOutcome: previous.outcome,
        previousEvidenceSource: previous.evidenceSource ?? null,
      },
    };
  } else {
    const raw = input.overrideMarks;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { ok: false, code: "INVALID_MARKS", message: "Enter a valid number of marks." };
    }
    if (raw < 0) {
      return { ok: false, code: "INVALID_MARKS", message: "Marks cannot be negative." };
    }
    if (raw > questionMaximumMarks) {
      return {
        ok: false,
        code: "INVALID_MARKS",
        message: `Marks cannot exceed the question's maximum of ${questionMaximumMarks}.`,
      };
    }

    awardedMarks = round(raw);
    const base: GradingResult =
      previous ??
      ({
        ...stageResultBase("GRADING", [
          "No pipeline grading result existed for this response; this record was created by teacher review.",
        ]),
        awardedMarks,
        maximumMarks: questionMaximumMarks,
        outcome: "FINAL",
        evidenceSource: "TEACHER_REVIEWED",
      } satisfies GradingResult);

    nextGrading = {
      ...base,
      awardedMarks,
      maximumMarks: questionMaximumMarks,
      outcome: "FINAL",
      evidenceSource: "TEACHER_REVIEWED",
      teacherReview: {
        action: "OVERRIDDEN",
        reviewedAt: decidedAt,
        reviewerId: teacherId,
        reviewItemId: item.id,
        previousAwardedMarks: previous?.awardedMarks ?? null,
        previousOutcome: previous?.outcome ?? null,
        previousEvidenceSource: previous?.evidenceSource ?? null,
      },
    };
  }

  const nextAnnotation = feedbackNote
    ? withTeacherFeedback(response.annotationResult, {
        note: feedbackNote,
        authoredAt: decidedAt,
        reviewerId: teacherId,
        reviewItemId: item.id,
      })
    : null;

  const decisionAction = action === "CONFIRM" ? "CONFIRMED" : "OVERRIDDEN";
  const decision: ReviewDecisionRecord = {
    contractVersion: REVIEW_DECISION_CONTRACT_VERSION,
    action: decisionAction,
    decidedAt,
    reviewerId: teacherId,
    questionResponseId: response.id,
    awardedMarks,
    previousAwardedMarks: previous?.awardedMarks ?? null,
    previousOutcome: previous?.outcome ?? null,
    previousEvidenceSource: previous?.evidenceSource ?? null,
    feedbackNote,
  };

  return prisma.$transaction(async (tx) => {
    // Claim first, conditionally. If a concurrent request (double-click, a
    // second tab) already resolved this item, this affects zero rows and we
    // back off without touching the response — so a mark can never be
    // applied twice or half-applied. Same advisory-lock shape the pipeline
    // uses to claim a QuestionResponse.
    const claimed = await tx.reviewItem.updateMany({
      where: { id: item.id, status: { in: [...ACTIONABLE_REVIEW_STATUSES] } },
      data: { status: "RESOLVED", reviewerId: teacherId, decision: decision as unknown as object },
    });
    if (claimed.count === 0) {
      return {
        ok: false as const,
        code: "ALREADY_RESOLVED" as const,
        message: "This review item has already been resolved.",
      };
    }

    await tx.questionResponse.update({
      where: { id: response.id },
      data: {
        status: "GRADED",
        gradingResult: nextGrading as unknown as object,
        ...(nextAnnotation ? { annotationResult: nextAnnotation as unknown as object } : {}),
      },
    });

    const submissionStatus = await recalculateSubmissionStatus(tx, response.submissionId);

    return {
      ok: true as const,
      action: decisionAction as ReviewDecisionRecord["action"],
      awardedMarks,
      questionResponseStatus: "GRADED" as const,
      submissionStatus,
      assessmentId: response.question.assessmentId,
      submissionId: response.submissionId,
    };
  });
}

/**
 * Attaches the teacher's note to the response's annotation record without
 * disturbing the machine-generated content already there. If the pipeline
 * never produced a usable annotation (e.g. the response FAILED before
 * annotation ran), a minimal valid record is created purely to carry the
 * note — otherwise the student's results page, which defensively rejects
 * malformed annotation JSON, would silently drop the teacher's feedback.
 */
function withTeacherFeedback(existing: unknown, note: TeacherFeedbackNote): AnnotationResult {
  const parsed = parseAnnotationResult(existing);
  const base: AnnotationResult =
    parsed ??
    ({
      ...stageResultBase("ANNOTATION", [
        "No pipeline annotation existed for this response; this record was created by teacher review.",
      ]),
      entries: [],
      needsHumanReview: false,
    } satisfies AnnotationResult);

  return { ...base, teacherFeedback: note };
}
