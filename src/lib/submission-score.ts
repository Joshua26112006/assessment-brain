import { parseGradingResult } from "@/lib/pipeline/parseResults";

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
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeSubmissionScore(
  questions: QuestionLike[],
  responses: ResponseLike[],
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

  return {
    questions: summaries,
    totalQuestions: summaries.length,
    confirmedCount: confirmed.length,
    needsReviewCount: summaries.filter((q) => q.state === "NEEDS_REVIEW").length,
    failedCount: summaries.filter((q) => q.state === "FAILED").length,
    pendingCount: summaries.filter((q) => q.state === "PENDING").length,
    teacherReviewedCount: confirmed.filter((q) => q.teacherReviewed).length,
    awardedMarks: round(confirmed.reduce((sum, q) => sum + (q.awardedMarks ?? 0), 0)),
    confirmedMaximumMarks: round(confirmed.reduce((sum, q) => sum + q.maximumMarks, 0)),
    totalMaximumMarks: round(summaries.reduce((sum, q) => sum + q.maximumMarks, 0)),
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

  return parts.length > 0 ? `${parts.join(" · ")}.` : "Waiting for evaluation to start.";
}
