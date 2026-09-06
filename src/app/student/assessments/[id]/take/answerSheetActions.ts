"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { processHandwrittenSubmission } from "@/lib/handwritten/processing";
import { evaluateHandwrittenSubmission } from "@/lib/handwritten/evaluation";

export type AnswerSheetSubmitState = { error?: string };

/**
 * Finalizes a handwritten submission: locks it from further page
 * uploads/deletions and hands it off for background processing —
 * Phase 3.4A/3.4B's read (deterministic validation, the AI answer-sheet
 * validation gate, and global handwriting reading), then, once that
 * produces a usable answer index, Phase 3.4C's evaluation (creating real
 * QuestionResponse rows and invoking the existing evaluation pipeline).
 *
 * Deliberately separate from the typed-answer submitAssessment() in
 * ./actions.ts rather than reusing it: that action derives its confirmation
 * copy from QuestionResponse counts and immediately knows which responses
 * to evaluate. A handwritten submission starts with zero QuestionResponse
 * rows — they only come to exist after processHandwrittenSubmission
 * successfully reads and maps the answer sheet, which is why evaluation is
 * chained here rather than folded into that shared action.
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

  // Handwritten processing (validation + global reading), then — only if
  // that produced a usable answer index — evaluation (QuestionResponse
  // creation + the existing pipeline), both run after this response is
  // sent, mirroring the existing background-pipeline pattern in the
  // typed-answer submit action and the question-paper extraction trigger —
  // the student isn't made to wait for any of it before their submission is
  // acknowledged. Neither function throws; an INVALID/FAILED processing
  // outcome simply never reaches evaluateHandwrittenSubmission.
  after(async () => {
    const result = await processHandwrittenSubmission(submissionId);
    if (result.outcome === "READY") {
      await evaluateHandwrittenSubmission(submissionId);
    }
  });

  revalidatePath("/student/assessments");
  revalidatePath("/student/dashboard");
  redirect("/student/results");
}
