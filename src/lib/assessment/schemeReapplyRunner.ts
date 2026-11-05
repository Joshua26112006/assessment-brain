import { prisma } from "@/lib/prisma";
import { runPipelineForQuestionResponse } from "@/lib/assessment/pipeline";
import { reapplyScheme } from "@/lib/assessment/schemeReapply";
import { markExactKeyAnswers } from "@/lib/assessment/exactKeyMarking";
import { runStructuredCorrectionForSubmission } from "@/lib/structuredCorrection/submission";

/**
 * Marks again a submission's waiting answers, through the same route a new submission would take:
 * a handwritten submission (it has photographed pages) goes through exact-answer marking and then the
 * page-by-page criteria marking (src/lib/handwritten/evaluation.ts); a typed submission goes through the
 * per-question checkpoint pipeline it always has.
 */
async function runSubmissionAgain(submissionId: string): Promise<void> {
  const handwritten = (await prisma.answerSheetPage.count({ where: { submissionId } })) > 0;

  if (handwritten) {
    await markExactKeyAnswers(submissionId);
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
