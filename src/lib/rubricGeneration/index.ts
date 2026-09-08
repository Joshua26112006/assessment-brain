import { prisma } from "@/lib/prisma";
import { generateRubricWithAi } from "./ai";
import { validateQuestionForRubricGeneration } from "./questionValidation";

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
 *
 * Phase 4.4: before any rubric content is generated, the question is first
 * run through validateQuestionForRubricGeneration. A question judged
 * REVIEW_REQUIRED is persisted as such and the function returns immediately
 * — generateRubricWithAi is never called for it, so a broken/ambiguous
 * question can never receive a rubric built on an invented assumption.
 * Deliberately NOT a separate claimed stage of its own: both steps run
 * inside this one already-claimed GENERATING window, so the teacher-facing
 * UI never needs a third "validating" status distinct from "generating."
 * The atomic claim only ever matches PENDING/FAILED, never REVIEW_REQUIRED —
 * once a question is flagged, nothing re-attempts it until the teacher
 * edits it (see updateQuestion in actions.ts, the only place that resets a
 * REVIEW_REQUIRED row back to PENDING).
 */
export async function generateRubricForQuestion(questionId: string): Promise<void> {
  const claimed = await prisma.rubric.updateMany({
    where: { questionId, generationStatus: { in: ["PENDING", "FAILED"] } },
    data: {
      generationStatus: "GENERATING",
      generationError: null,
      validationIssueType: null,
      validationIssueSummary: null,
      validationExplanation: null,
    },
  });
  if (claimed.count === 0) return;

  try {
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: {
        questionNumber: true,
        questionText: true,
        maximumMarks: true,
        assessment: { select: { title: true, subject: true, grade: true, curriculum: true } },
      },
    });
    if (!question) {
      throw new Error("This question no longer exists.");
    }

    const validation = await validateQuestionForRubricGeneration({
      questionNumber: question.questionNumber,
      questionText: question.questionText,
      maximumMarks: Number(question.maximumMarks),
      subject: question.assessment.subject,
      grade: question.assessment.grade,
      curriculum: question.assessment.curriculum,
      assessmentTitle: question.assessment.title,
    });

    if (validation.status === "REVIEW_REQUIRED") {
      await prisma.rubric.update({
        where: { questionId },
        data: {
          generationStatus: "REVIEW_REQUIRED",
          generationError: null,
          validationIssueType: validation.issueType,
          validationIssueSummary: validation.issueSummary,
          validationExplanation: validation.explanation,
        },
      });
      return;
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
          structuredExpectation: (draft.structuredExpectation as unknown as object) ?? undefined,
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
          validationIssueType: null,
          validationIssueSummary: null,
          validationExplanation: null,
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
        data: {
          generationStatus: "FAILED",
          generationError: message,
          validationIssueType: null,
          validationIssueSummary: null,
          validationExplanation: null,
        },
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

/**
 * Phase 4.3 — the assessment-level "Generate All Rubrics" / "Retry Failed
 * Rubrics" engine. Deliberately a thin orchestrator over the existing
 * per-question engine above: it never talks to the AI or writes a
 * RubricVersion itself, it only decides WHICH questions still need
 * generateRubricForQuestion called on them, then reuses
 * generateRubricsForQuestions unchanged.
 *
 * A question is included if its rubric is:
 *   - missing entirely (a Rubric row is created for it first, PENDING by
 *     default, exactly like createQuestion/approveExtraction already do —
 *     this only covers a genuinely old Question row that predates a Rubric
 *     row always being created alongside it);
 *   - PENDING (never yet attempted); or
 *   - FAILED (this is also what makes this function double as "retry failed
 *     rubrics" — a second call after a partial failure naturally only
 *     re-attempts the FAILED ones, since every READY question is excluded
 *     and there are no longer any PENDING/missing ones left).
 *
 * READY and GENERATING are deliberately excluded up front — not just
 * because generateRubricForQuestion's own atomic claim would no-op on them
 * anyway (it would), but so an assessment with many already-READY questions
 * doesn't pay for a wasted claim attempt and question lookup on every one of
 * them each time this runs.
 *
 * REVIEW_REQUIRED (Phase 4.4) is also deliberately excluded: a question the
 * validator flagged needs the teacher to actually change something first —
 * blindly re-running the same unedited question through the same validator
 * would almost always just reproduce the same verdict. It only re-enters
 * this target set once updateQuestion resets it back to PENDING after an
 * edit; there is no bulk "retry flagged questions" path by design.
 *

 * Safe to call concurrently (double-click, or a stray retry racing this):
 * each question's own PENDING/FAILED -> GENERATING claim inside
 * generateRubricForQuestion is what actually serializes work per question,
 * so two overlapping calls to this function simply end up claiming disjoint
 * subsets of whatever was still unclaimed — never duplicate work.
 */
export async function generateAllRubricsForAssessment(assessmentId: string): Promise<void> {
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { id: true, rubric: { select: { generationStatus: true } } },
  });

  const missingRubricQuestionIds = questions.filter((q) => !q.rubric).map((q) => q.id);
  if (missingRubricQuestionIds.length > 0) {
    await prisma.rubric.createMany({
      data: missingRubricQuestionIds.map((questionId) => ({ questionId })),
      skipDuplicates: true,
    });
  }

  const questionIdsNeedingGeneration = questions
    .filter((q) => !q.rubric || q.rubric.generationStatus === "PENDING" || q.rubric.generationStatus === "FAILED")
    .map((q) => q.id);

  await generateRubricsForQuestions(questionIdsNeedingGeneration);
}
