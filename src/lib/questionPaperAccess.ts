import { prisma } from "@/lib/prisma";

/**
 * Ownership predicates for question-paper access — the Phase 3.3 teacher-side
 * counterpart to src/lib/answerSheetAccess.ts. Centralized so "does this
 * assessment/question-paper/page belong to this teacher" is asked
 * identically everywhere. Return `null` rather than calling notFound() —
 * route handlers and Server Actions need a JSON/plain-object result, not a
 * page-rendering short-circuit — but the underlying rule is the same one
 * used throughout the app: an unauthorized id is indistinguishable from a
 * nonexistent one.
 */

/** Statuses in which a QuestionPaper draft may still be uploaded to, retried, or deleted. */
const DRAFT_EXTRACTION_STATUSES = ["PENDING", "PROCESSING", "EXTRACTED", "FAILED"] as const;

export function isDraftExtractionStatus(status: string): boolean {
  return (DRAFT_EXTRACTION_STATUSES as readonly string[]).includes(status);
}

export async function findOwnedAssessmentForTeacher(assessmentId: string, teacherId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId },
    select: { id: true, title: true, instructions: true, status: true },
  });
}

/**
 * The current (most recently created) QuestionPaper for an assessment, if
 * any, scoped to the owning teacher — mirrors "the latest QuestionPaper is
 * the canonical current draft" convention used throughout the review flow.
 */
export async function findCurrentQuestionPaperForTeacher(assessmentId: string, teacherId: string) {
  return prisma.questionPaper.findFirst({
    where: { assessmentId, assessment: { teacherId } },
    orderBy: { createdAt: "desc" },
    include: { pages: { orderBy: { pageNumber: "asc" } } },
  });
}

export async function findOwnedQuestionPaperPageForTeacher(
  assessmentId: string,
  pageId: string,
  teacherId: string,
) {
  return prisma.questionPaperPage.findFirst({
    where: {
      id: pageId,
      questionPaper: { assessmentId, assessment: { teacherId } },
    },
  });
}
