/**
 * The one place that decides whether a student may see their marks.
 *
 * The rule (decision D1 of 06-correction-hardening-plan.md): an AI-produced
 * mark never reaches a student on its own. A submission's marks, feedback and
 * marked-up pages become visible only once a teacher has released it, which
 * sets `Submission.releasedAt`. How finished the marking is, or what a
 * response's grading outcome says, makes no difference.
 *
 * Every student-facing page, list and file route goes through the functions
 * here, so there is a single rule to read, test and change.
 */

export interface ReleasableSubmission {
  releasedAt: Date | null;
}

/** Pseudo-status shown to a student whose marking is finished but not yet released. */
export const AWAITING_RELEASE = "AWAITING_RELEASE";

export function isReleasedForStudent(submission: ReleasableSubmission): boolean {
  return submission.releasedAt !== null && submission.releasedAt !== undefined;
}

/**
 * Submission statuses that mean "marking has finished or stopped". Until the
 * teacher releases the result, a student sees all of them as the same thing:
 * their teacher has it. DRAFT, SUBMITTED and PROCESSING are shown as they are —
 * they say nothing about marks.
 */
const FINISHED_STATUSES = new Set(["COMPLETED", "NEEDS_REVIEW", "FAILED"]);

/** The status to show a student: the real one once released, else AWAITING_RELEASE for finished work. */
export function studentFacingStatus(submission: ReleasableSubmission & { status: string }): string {
  if (isReleasedForStudent(submission)) return submission.status;
  return FINISHED_STATUSES.has(submission.status) ? AWAITING_RELEASE : submission.status;
}

/**
 * Per-question results as a student may see them. Before release, every
 * response is reduced to "still being marked": no mark, no feedback, no
 * correction detail, and a status that does not reveal whether it was graded,
 * failed or sent for review. The student's own answer text is untouched.
 */
export function responsesVisibleToStudent<
  T extends { status: string; gradingResult: unknown; annotationResult: unknown },
>(submission: ReleasableSubmission, responses: T[]): T[] {
  if (isReleasedForStudent(submission)) return responses;
  return responses.map((response) => ({
    ...response,
    status: "PENDING",
    gradingResult: null,
    annotationResult: null,
    ...("correctionResult" in response ? { correctionResult: null } : {}),
  }));
}

/**
 * May the AI's own written feedback reach the student? (Owner's decision, Nov 5.) Only while the teacher accepted the
 * AI's mark as it was. Once the teacher has changed the mark, text the AI wrote for the old mark could contradict the
 * new one, so it is withheld and the student reads the teacher's own comment instead. Any change counts, even one
 * that lands on the same number: it errs on the side of withholding.
 */
export function aiFeedbackMayReachStudent(gradingResult: { teacherReview?: { action?: string } | null } | null | undefined): boolean {
  return gradingResult?.teacherReview?.action !== "OVERRIDDEN";
}

/** Whether a student may be sent a teacher-marked-up copy of a page (`?annotated=1`). */
export function mayServeAnnotatedPage(submission: ReleasableSubmission): boolean {
  return isReleasedForStudent(submission);
}
