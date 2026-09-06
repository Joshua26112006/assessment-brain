"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { runPipelineForQuestionResponse } from "@/lib/assessment/pipeline";
import { recalculateSubmissionStatus } from "@/lib/assessment/submissionStatusSync";

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

  // Ownership was already established above (getEditableOwnedSubmission
  // confirmed this submission belongs to the authenticated student) — this
  // query is scoped by that same, already-verified submissionId, so a
  // student can never trigger processing for anyone else's work.
  const responses = await prisma.questionResponse.findMany({
    where: { submissionId },
    select: { id: true },
  });

  // Evaluate every response after this response has been sent to the
  // student, so submitting doesn't make them wait for grading. `after()`
  // is Next.js's built-in primitive for exactly this (runs even though
  // this action calls redirect() below) — no queue, worker, or other
  // background infrastructure needed.
  after(async () => {
    if (responses.length === 0) return;

    await prisma.submission
      .update({ where: { id: submissionId }, data: { status: "PROCESSING" } })
      .catch(() => {});

    // Promise.allSettled, not Promise.all: one response's pipeline failure
    // must never prevent or roll back another response's successful
    // result. Each runPipelineForQuestionResponse call is independently
    // persisted, so isolation holds even if this rejects.
    const outcomes = await Promise.allSettled(
      responses.map((response) => runPipelineForQuestionResponse(response.id)),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        // The orchestrator already catches its own errors internally and
        // persists FAILED on that one response — this only fires for a
        // truly unexpected failure outside that. Logged, never rethrown,
        // so it can't affect any other response's result.
        console.error("Unexpected pipeline failure", outcome.reason);
      }
    }

    // One aggregate write after the whole batch settles, using the
    // existing SubmissionStatus enum values (PROCESSING/COMPLETED/
    // NEEDS_REVIEW/FAILED already exist for exactly this) rather than a
    // new column — re-derived fresh from QuestionResponse so it can't
    // drift out of sync with the per-question outcomes. Shared with the
    // teacher review workflow, which re-derives the same way after a
    // human decision changes a response's status.
    await recalculateSubmissionStatus(prisma, submissionId).catch(() => {});
  });

  revalidatePath("/student/assessments");
  revalidatePath("/student/dashboard");
  redirect("/student/results");
}
