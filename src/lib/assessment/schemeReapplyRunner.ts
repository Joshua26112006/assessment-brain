import { prisma } from "@/lib/prisma";
import { runPipelineForQuestionResponse } from "@/lib/assessment/pipeline";
import { reapplyScheme } from "@/lib/assessment/schemeReapply";
import { hasCheckableRubric, runStructuredCorrectionForSubmission } from "@/lib/structuredCorrection/submission";

/**
 * Marks again a submission's waiting answers, through the same route a new
 * submission would take (src/lib/handwritten/evaluation.ts): the structured
 * route when the assessment has checkable rubrics, the checkpoint pipeline otherwise.
 */
async function runSubmissionAgain(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({ where: { id: submissionId }, select: { assessmentId: true } });
  if (!submission) return;

  if (await hasCheckableRubric(submission.assessmentId)) {
    await runStructuredCorrectionForSubmission(submissionId);
    return;
  }

  const waiting = await prisma.questionResponse.findMany({
    where: { submissionId, status: "PENDING" },
    select: { id: true },
  });
  await Promise.allSettled(waiting.map((response) => runPipelineForQuestionResponse(response.id)));
}

/** Called after a scheme is approved or changed. Never throws: a failure here must not undo the teacher's save. */
export async function reapplyAfterSchemeChange(questionId: string, actorId: string): Promise<void> {
  try {
    await reapplyScheme({ questionId, actorId, runSubmission: runSubmissionAgain });
  } catch (error) {
    console.error("Could not re-apply a changed marking scheme to answers already drafted", error);
  }
}
