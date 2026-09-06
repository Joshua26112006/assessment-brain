import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { reviewItemOwnedByTeacher } from "@/lib/review-scope";

/**
 * Loads one ReviewItem with the full context a teacher needs to make a
 * genuine academic decision: the student's answer, the exact RubricVersion
 * the pipeline pinned (never the currently-active one, which may have moved
 * on since), and every persisted evaluation result.
 *
 * notFound() — not a "forbidden" page — for an item belonging to another
 * teacher, so probing IDs can't distinguish "doesn't exist" from "exists,
 * not yours". Mirrors getOwnedAssessmentOrNotFound.
 */
export async function getOwnedReviewItemOrNotFound(reviewItemId: string, teacherId: string) {
  const item = await prisma.reviewItem.findFirst({
    where: { id: reviewItemId, ...reviewItemOwnedByTeacher(teacherId) },
    include: {
      assessment: {
        select: { id: true, title: true, subject: true, grade: true, curriculum: true },
      },
      question: {
        select: { id: true, questionNumber: true, questionText: true, maximumMarks: true },
      },
      submission: {
        select: {
          id: true,
          status: true,
          submittedAt: true,
          student: { select: { id: true, name: true } },
          assessment: {
            select: { id: true, title: true, subject: true, grade: true, curriculum: true },
          },
        },
      },
      questionResponse: {
        select: {
          id: true,
          status: true,
          studentAnswer: true,
          correctionResult: true,
          annotationResult: true,
          gradingResult: true,
          // The rubric version pinned at evaluation time — deliberately not
          // question.rubric.activeVersion, which may since have changed.
          rubricVersionUsed: {
            select: {
              id: true,
              versionNumber: true,
              status: true,
              solutionApproaches: true,
              markingCheckpoints: true,
            },
          },
        },
      },
      reviewer: { select: { id: true, name: true } },
    },
  });

  if (!item) {
    notFound();
  }

  return item;
}
