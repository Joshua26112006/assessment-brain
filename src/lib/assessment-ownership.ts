import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Fetches an assessment scoped to the given teacher, with questions
 * (ordered) and their rubric/active-version loaded. Returns `notFound()`
 * rather than a generic "forbidden" so a teacher probing another teacher's
 * assessment ID can't distinguish "doesn't exist" from "exists, not yours" —
 * the URL alone never grants access regardless of which case it is.
 */
export async function getOwnedAssessmentOrNotFound(
  assessmentId: string,
  teacherId: string,
) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId },
    include: {
      class: true,
      questions: {
        orderBy: { questionNumber: "asc" },
        include: {
          rubric: {
            include: {
              activeVersion: true,
              versions: { orderBy: { versionNumber: "desc" } },
            },
          },
        },
      },
    },
  });

  if (!assessment) {
    notFound();
  }

  return assessment;
}

/** Throws if the question doesn't belong to an assessment owned by teacherId. */
export async function getOwnedQuestionOrNotFound(
  questionId: string,
  teacherId: string,
) {
  const question = await prisma.question.findFirst({
    where: { id: questionId, assessment: { teacherId } },
    include: { assessment: true },
  });

  if (!question) {
    notFound();
  }

  return question;
}
