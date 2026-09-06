import { prisma } from "@/lib/prisma";
import { generateRubricWithAi } from "./ai";

/**
 * Runs (or re-runs) automatic AI rubric generation for one Question and
 * persists the result. Never throws — every failure path (question missing,
 * AI/network failure, malformed AI output) is caught and persisted as
 * generationStatus FAILED with a plain-language generationError, so a
 * teacher never sees a silently-stuck PENDING/GENERATING row or an
 * unhandled exception. Safe to call from a background `after()` task
 * (question creation) or a synchronous Server Action (manual retry) — both
 * just await this and re-read the row afterward.
 *
 * Requires a Rubric row to already exist for this question (created
 * alongside the Question itself — see questionPaperActions.ts/actions.ts).
 * If none exists (a truly old Question row that predates this phase), the
 * atomic claim below simply matches nothing and this returns without doing
 * anything unsafe; callers that might hit that case (the manual retry
 * action) upsert the Rubric row first.
 *
 * Atomic compare-and-swap, not a plain read-then-write — mirrors
 * SubmissionProcessing's and QuestionPaper's identical PENDING/FAILED ->
 * in-progress claim: an UPDATE ... WHERE generationStatus IN (...) takes a
 * row lock, so two near-simultaneous triggers (a retry click racing the
 * original background task, or two batch triggers for the same question)
 * can never both run generation for the same question at once.
 */
export async function generateRubricForQuestion(questionId: string): Promise<void> {
  const claimed = await prisma.rubric.updateMany({
    where: { questionId, generationStatus: { in: ["PENDING", "FAILED"] } },
    data: { generationStatus: "GENERATING", generationError: null },
  });
  if (claimed.count === 0) return;

  try {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: {
        questionText: true,
        maximumMarks: true,
        assessment: { select: { title: true, subject: true, grade: true, curriculum: true } },
      },
    });
    if (!question) {
      throw new Error("This question no longer exists.");
    }

    const draft = await generateRubricWithAi({
      questionText: question.questionText,
      maximumMarks: Number(question.maximumMarks),
      subject: question.assessment.subject,
      grade: question.assessment.grade,
      curriculum: question.assessment.curriculum,
      assessmentTitle: question.assessment.title,
    });

    await prisma.$transaction(async (tx) => {
      const rubric = await tx.rubric.findUnique({
        where: { questionId },
        select: { id: true, activeVersionId: true },
      });
      if (!rubric) {
        throw new Error("The rubric row for this question is missing.");
      }

      const highestVersion = await tx.rubricVersion.aggregate({
        where: { rubricId: rubric.id },
        _max: { versionNumber: true },
      });
      const nextVersionNumber = (highestVersion._max.versionNumber ?? 0) + 1;

      const newVersion = await tx.rubricVersion.create({
        data: {
          rubricId: rubric.id,
          versionNumber: nextVersionNumber,
          status: "ACTIVE",
          solutionApproaches: draft.solutionApproaches as unknown as object,
          markingCheckpoints: draft.markingCheckpoints as unknown as object,
          expectedAnswer: draft.expectedAnswer,
          partialCreditGuidance: draft.partialCreditGuidance,
        },
      });

      if (rubric.activeVersionId) {
        await tx.rubricVersion.update({
          where: { id: rubric.activeVersionId },
          data: { status: "SUPERSEDED" },
        });
      }

      await tx.rubric.update({
        where: { id: rubric.id },
        data: {
          activeVersionId: newVersion.id,
          generationStatus: "READY",
          generationError: null,
        },
      });
    });
  } catch (error) {
    // Never persist a raw stack trace or provider error body (potentially
    // containing request internals) — a short, plain message only.
    const message =
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : "Rubric generation failed unexpectedly. Please try again.";

    await prisma.rubric
      .update({
        where: { questionId },
        data: { generationStatus: "FAILED", generationError: message },
      })
      .catch(() => {
        // The row may have been deleted concurrently (the question itself
        // was deleted mid-generation) — nothing left to mark as failed.
      });
  }
}

/**
 * Generates rubrics for several newly-created questions independently.
 * Deliberately Promise.allSettled, not Promise.all: one question's
 * generation failure must never prevent the others from completing —
 * mirrors evaluateHandwrittenSubmission's identical reasoning for
 * per-question pipeline runs.
 */
export async function generateRubricsForQuestions(questionIds: string[]): Promise<void> {
  await Promise.allSettled(questionIds.map((id) => generateRubricForQuestion(id)));
}
