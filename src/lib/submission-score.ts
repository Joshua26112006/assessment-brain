import { parseGradingResult } from "@/lib/pipeline/parseResults";
import { paperTotals, wasAttempted } from "@/lib/questions/paperScore";

/**
 * One deterministic answer to "what is this submission's score right now?",
 * shared by the student's results list, the student's result detail page,
 * and the teacher's per-assessment submissions view.
 *
 * The rule it encodes is deliberately conservative and is the same one the
 * results detail page has always used: a question contributes to the score
 * ONLY when its response is GRADED *and* carries a parseable grading result
 * whose outcome is FINAL. Anything else — still evaluating, awaiting teacher
 * review, failed, unanswered, or grading JSON that doesn't parse — is
 * reported separately and never silently counted as zero, because a missing
 * mark and a zero mark mean very different things to a student.
 */

export type QuestionResultState = "CONFIRMED" | "NEEDS_REVIEW" | "FAILED" | "PENDING";

export interface QuestionResultSummary {
  questionId: string;
  questionNumber: number;
  maximumMarks: number;
  state: QuestionResultState;
  /** Only set when state is CONFIRMED — never a guess. */
  awardedMarks: number | null;
  /** True when a teacher confirmed or overrode this mark. */
  teacherReviewed: boolean;
  /** False when the student never saved an answer for this question. */
  answered: boolean;
  /** This answer's marks are in the total. False for an alternative that did not count (see overAttempt). */
  counted: boolean;
  /**
   * The student answered this AND a better alternative counts instead ("(a) OR (b)", "any 5 of 7"):
   * shown with a * and left out of the total (decision D14).
   */
  overAttempt: boolean;
}

export interface SubmissionScoreSummary {
  questions: QuestionResultSummary[];
  totalQuestions: number;
  confirmedCount: number;
  needsReviewCount: number;
  failedCount: number;
  pendingCount: number;
  teacherReviewedCount: number;
  /** Sum of awarded marks across confirmed questions only. */
  awardedMarks: number;
  /** Sum of maximum marks across confirmed questions only — the honest denominator for `awardedMarks`. */
  confirmedMaximumMarks: number;
  /** Sum of maximum marks across every question in the assessment. */
  totalMaximumMarks: number;
  hasAnyConfirmed: boolean;
  /** True only when every question in the assessment has a confirmed mark. */
  allConfirmed: boolean;
}

interface QuestionLike {
  id: string;
  questionNumber: number;
  maximumMarks: unknown;
}

interface ResponseLike {
  questionId: string;
  status: string;
  gradingResult: unknown;
  /** Used to tell an answer the student wrote from a question recorded as not attempted. */
  studentAnswer?: unknown;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `questionTree` is the assessment's stored structure (parts, choices, optional groups). Omitted or
 * null, the paper is a flat list, which is how every paper behaved before structure existed.
 */
export function summarizeSubmissionScore(
  questions: QuestionLike[],
  responses: ResponseLike[],
  questionTree: unknown = null,
): SubmissionScoreSummary {
  const responseByQuestionId = new Map(responses.map((r) => [r.questionId, r]));

  const summaries: QuestionResultSummary[] = questions.map((question) => {
    const maximumMarks = Number(question.maximumMarks);
    const response = responseByQuestionId.get(question.id);

    const base = {
      questionId: question.id,
      questionNumber: question.questionNumber,
      maximumMarks,
      awardedMarks: null,
      teacherReviewed: false,
      answered: Boolean(response),
      counted: true,
      overAttempt: false,
    };

    if (!response) return { ...base, state: "PENDING" as const };
    if (response.status === "FAILED") return { ...base, state: "FAILED" as const };
    if (response.status === "NEEDS_REVIEW") return { ...base, state: "NEEDS_REVIEW" as const };
    if (response.status !== "GRADED") return { ...base, state: "PENDING" as const };

    const grading = parseGradingResult(response.gradingResult);
    if (!grading || grading.outcome !== "FINAL") {
      // GRADED, but the stored result doesn't parse as a final grade. Treated
      // as not-yet-available rather than displayed as if it were valid.
      return { ...base, state: "PENDING" as const };
    }

    return {
      ...base,
      state: "CONFIRMED" as const,
      awardedMarks: grading.awardedMarks,
      teacherReviewed: grading.evidenceSource === "TEACHER_REVIEWED",
      // A confirmed question's own maximum comes from the grading record the
      // pipeline actually used, falling back to the question's current value.
      maximumMarks: grading.maximumMarks || maximumMarks,
    };
  });

  const confirmed = summaries.filter((q) => q.state === "CONFIRMED");

  // The paper's structure decides what counts: parts add up, the better of "(a) OR (b)" counts, and
  // "any N of M" counts the best N. Answers still waiting for a mark are not yet counted either way.
  const responseById = new Map(responses.map((response) => [response.questionId, response]));
  const confirmedIds = new Set(confirmed.map((q) => q.questionId));
  const attempted = (questionId: string) => {
    const response = responseById.get(questionId);
    // No studentAnswer on the object: the caller did not select it, so an existing response counts as written.
    return Boolean(response) && (response!.studentAnswer === undefined ? true : wasAttempted(response!.studentAnswer));
  };
  const confirmedTotals = paperTotals(
    questionTree,
    summaries.map((q) => ({
      questionId: q.questionId,
      maximumMarks: confirmedIds.has(q.questionId) ? q.maximumMarks : 0,
      awardedMarks: confirmedIds.has(q.questionId) ? q.awardedMarks : null,
      attempted: confirmedIds.has(q.questionId) && attempted(q.questionId),
    })),
  );
  const paper = paperTotals(
    questionTree,
    summaries.map((q) => ({ questionId: q.questionId, maximumMarks: q.maximumMarks, awardedMarks: null, attempted: false })),
  );
  for (const summary of summaries) {
    const outcome = confirmedTotals.perLeaf.get(summary.questionId);
    if (!outcome) continue;
    summary.counted = outcome.counted;
    summary.overAttempt = outcome.overAttempt;
  }

  return {
    questions: summaries,
    totalQuestions: summaries.length,
    confirmedCount: confirmed.length,
    needsReviewCount: summaries.filter((q) => q.state === "NEEDS_REVIEW").length,
    failedCount: summaries.filter((q) => q.state === "FAILED").length,
    // A question the student never answered is not "still being evaluated"; it is counted on its own.
    pendingCount: summaries.filter((q) => q.state === "PENDING" && q.answered).length,
    teacherReviewedCount: confirmed.filter((q) => q.teacherReviewed).length,
    awardedMarks: confirmedTotals.awarded,
    confirmedMaximumMarks: confirmedTotals.maximum,
    totalMaximumMarks: paper.maximum,
    hasAnyConfirmed: confirmed.length > 0,
    allConfirmed: confirmed.length === summaries.length && summaries.length > 0,
  };
}

/**
 * Short, truthful description of where a submission stands, derived from the
 * per-question states rather than restating the stored SubmissionStatus —
 * so it can never claim "results available" while questions are still open.
 */
export function describeEvaluationProgress(summary: SubmissionScoreSummary): string {
  if (summary.totalQuestions === 0) return "No questions on this assessment.";
  if (summary.allConfirmed) return "Evaluation complete.";

  const parts: string[] = [];
  if (summary.confirmedCount > 0) {
    parts.push(`${summary.confirmedCount} of ${summary.totalQuestions} graded`);
  }
  if (summary.pendingCount > 0) parts.push(`${summary.pendingCount} still being evaluated`);
  if (summary.needsReviewCount > 0) parts.push(`${summary.needsReviewCount} awaiting teacher review`);
  if (summary.failedCount > 0) parts.push(`${summary.failedCount} could not be evaluated`);
  const notAnswered = summary.questions.filter((q) => !q.answered).length;
  if (notAnswered > 0) parts.push(`${notAnswered} not answered`);

  return parts.length > 0 ? `${parts.join(" · ")}.` : "Waiting for evaluation to start.";
}
