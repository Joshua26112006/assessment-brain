import { prisma } from "@/lib/prisma";

/**
 * Ownership predicates for answer-sheet access, shared by every student and
 * teacher route handler that touches AnswerSheetPage rows. Centralized so
 * "does this submission/page belong to this user" is asked identically
 * everywhere, the same way review-scope.ts centralizes ReviewItem ownership.
 *
 * These return `null` rather than calling notFound() — route handlers need
 * a JSON 404, not a page-rendering short-circuit — but the underlying rule
 * is the same one used throughout the app: an unauthorized id is
 * indistinguishable from a nonexistent one.
 */

/** Statuses in which a student may still add or remove answer-sheet pages. */
export const ANSWER_SHEET_EDITABLE_STATUSES = ["DRAFT"] as const;

export function isAnswerSheetEditableStatus(status: string): boolean {
  return (ANSWER_SHEET_EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The submission a student is uploading/deleting pages on, with just enough
 * of the assessment to re-check it's still legitimately available — the
 * same defense-in-depth check submitAssessment already applies ("a teacher
 * could theoretically withdraw it between the student opening it and
 * submitting").
 */
export async function findOwnedSubmissionForStudent(submissionId: string, studentId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, studentId },
    select: {
      id: true,
      status: true,
      assessment: { select: { status: true } },
    },
  });
}

export async function findOwnedAnswerSheetPageForStudent(
  submissionId: string,
  pageId: string,
  studentId: string,
) {
  return prisma.answerSheetPage.findFirst({
    where: { id: pageId, submissionId, submission: { studentId } },
    include: { submission: { select: { id: true, status: true } } },
  });
}

/**
 * A teacher may only reach a submission's answer sheets through the
 * assessment they own — the direct, non-nullable path Submission always
 * has to Assessment (unlike ReviewItem's four independently-optional
 * links), so this is a single ownership predicate rather than the OR-chain
 * reviewItemOwnedByTeacher needs.
 */
export async function findOwnedSubmissionForTeacher(submissionId: string, teacherId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, assessment: { teacherId } },
    select: { id: true, status: true },
  });
}

export async function findOwnedAnswerSheetPageForTeacher(
  submissionId: string,
  pageId: string,
  teacherId: string,
) {
  return prisma.answerSheetPage.findFirst({
    where: { id: pageId, submissionId, submission: { assessment: { teacherId } } },
  });
}
