"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";

export type ActionState = { error?: string; success?: boolean };

/**
 * Loads the submission and confirms, server-side, that it actually belongs
 * to this student and is still editable (DRAFT). Every mutation below goes
 * through this before touching the database — the submissionId in the URL
 * or form is never trusted on its own.
 */
async function getEditableOwnedSubmission(submissionId: string, studentId: string) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, studentId },
    include: { assessment: true },
  });
  if (!submission) {
    return { error: "Submission not found." } as const;
  }
  if (submission.status !== "DRAFT") {
    return { error: "This assessment has already been submitted and can no longer be edited." } as const;
  }
  return { submission } as const;
}

export async function saveAnswer(
  submissionId: string,
  questionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireStudentSession();

  const result = await getEditableOwnedSubmission(submissionId, session.user.id);
  if ("error" in result) {
    return { error: result.error };
  }
  const { submission } = result;

  // The question must actually belong to this submission's assessment —
  // never trust a question ID sent alongside the form on its own.
  const question = await prisma.question.findFirst({
    where: { id: questionId, assessmentId: submission.assessmentId },
    select: { id: true },
  });
  if (!question) {
    return { error: "That question does not belong to this assessment." };
  }

  const answerText = String(formData.get("answerText") ?? "");

  await prisma.questionResponse.upsert({
    where: { submissionId_questionId: { submissionId, questionId } },
    create: {
      submissionId,
      questionId,
      studentAnswer: { text: answerText },
    },
    update: {
      studentAnswer: { text: answerText },
    },
  });

  revalidatePath(`/student/assessments/${submission.assessmentId}/take`);
  return { success: true };
}

export async function submitAssessment(
  submissionId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireStudentSession();

  const result = await getEditableOwnedSubmission(submissionId, session.user.id);
  if ("error" in result) {
    return { error: result.error };
  }
  const { submission } = result;

  // The assessment must still be published — a teacher could theoretically
  // withdraw it between the student opening it and submitting.
  if (submission.assessment.status !== "PUBLISHED") {
    return { error: "This assessment is no longer available for submission." };
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  revalidatePath("/student/assessments");
  revalidatePath("/student/dashboard");
  redirect("/student/results");
}
