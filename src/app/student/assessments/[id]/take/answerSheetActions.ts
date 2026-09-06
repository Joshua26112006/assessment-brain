"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";

export type AnswerSheetSubmitState = { error?: string };

/**
 * Finalizes a handwritten submission: locks it from further page
 * uploads/deletions and hands it off for evaluation.
 *
 * Deliberately separate from the typed-answer submitAssessment() in
 * ./actions.ts rather than reusing it: that action derives its confirmation
 * copy from QuestionResponse counts and, after redirecting, evaluates every
 * QuestionResponse through the AI pipeline. A handwritten submission has no
 * QuestionResponse rows at all, so this action only ever flips Submission
 * to SUBMITTED — it never touches QuestionResponse and never calls
 * runPipelineForQuestionResponse. Wiring uploaded pages into evaluation is
 * explicitly out of scope for this phase.
 */
export async function submitAnswerSheetsForEvaluation(
  submissionId: string,
  _prevState: AnswerSheetSubmitState,
): Promise<AnswerSheetSubmitState> {
  const session = await requireStudentSession();

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, studentId: session.user.id },
    include: {
      assessment: { select: { status: true } },
      _count: { select: { answerSheetPages: true } },
    },
  });

  if (!submission) {
    return { error: "Submission not found." };
  }
  if (submission.status !== "DRAFT") {
    return { error: "This assessment has already been submitted and can no longer be edited." };
  }
  // Defense-in-depth, matching the same re-check the typed-answer flow and
  // the answer-sheet upload API both apply: a teacher could withdraw the
  // assessment between the student opening it and submitting.
  if (submission.assessment.status !== "PUBLISHED") {
    return { error: "This assessment is no longer available for submission." };
  }
  if (submission._count.answerSheetPages === 0) {
    return { error: "Upload at least one answer-sheet page before submitting." };
  }

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  revalidatePath("/student/assessments");
  revalidatePath("/student/dashboard");
  redirect("/student/results");
}
