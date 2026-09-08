import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { readMathAnswers } from "@/lib/mathCorrection/structuredReading";
import { correctMathQuestion, type MathQuestionCorrection } from "@/lib/mathCorrection/pipeline";
import { annotateAnswerSheet, type AnnotatableQuestion } from "@/lib/mathCorrection/annotation";
import { PIPELINE_CONTRACT_VERSION } from "@/types/pipeline";
import type { AnnotationResult, GradingResult } from "@/types/pipeline";
import type { ReconciledMathReading, StructuredExpectation } from "@/types/mathCorrection";
import type { RubricMarkingCheckpoint } from "@/types/rubricGeneration";

/**
 * Runs the Mathematics correction flow for one handwritten submission and
 * writes the results into the SAME QuestionResponse fields the existing
 * evaluation pipeline uses, so every teacher and student screen renders them
 * without changing a line of UI.
 *
 * Only ever reached for a Mathematics assessment (see
 * evaluateHandwrittenSubmission). Every other subject continues down the
 * existing per-question pipeline untouched.
 *
 * Never throws. A submission that cannot be read at all is left for the
 * existing flow to report; per-question failures are recorded as review items
 * rather than silently becoming a zero.
 */

/** Statuses meaning a response has already been fully attempted — never recomputed. */
const TERMINAL_STATUSES = ["GRADED", "NEEDS_REVIEW", "FAILED"];

interface QuestionContext {
  questionId: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  expectedAnswer: string | null;
  partialCreditGuidance: string | null;
  markingCheckpoints: RubricMarkingCheckpoint[];
  structuredExpectation: StructuredExpectation | null;
  rubricVersionId: string | null;
  responseId: string;
  sourcePages: number[];
}

function stageBase<T extends string>(stage: T) {
  return {
    stage,
    contractVersion: PIPELINE_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    warnings: [] as string[],
  };
}

function buildGradingResult(correction: MathQuestionCorrection, maximumMarks: number): GradingResult {
  const awardedMarks = correction.score?.awardedMarks ?? 0;
  return {
    ...stageBase("GRADING" as const),
    awardedMarks,
    maximumMarks,
    // A mark that was produced is final. Uncertainty about WHERE a student went
    // wrong is not a reason to withhold their result from them and queue it for
    // a teacher — unconfirmed findings are simply not shown. Only a mark that
    // could not be produced at all is left for a human.
    outcome: correction.score ? "FINAL" : "NEEDS_REVIEW",
    // The mark comes from an AI examiner reading the rubric, and any findings
    // shown alongside it were independently verified. "DETERMINISTIC" would be
    // plainly untrue here — no deterministic marking took place — so of the
    // available provenance values this is the honest one.
    evidenceSource: "AI_VERIFIED",
  };
}

/**
 * Written into the existing annotation shape so the student results page and
 * the teacher review queue both render it as they already do. `entries` stays
 * empty because this flow produces no per-checkpoint outcomes — the findings
 * it does produce are the verified, question-level explanations below.
 */
function buildAnnotationResult(correction: MathQuestionCorrection): AnnotationResult {
  const improvements = correction.explanations.map((explanation) => explanation.explanation);

  return {
    ...stageBase("ANNOTATION" as const),
    entries: [],
    needsHumanReview: !correction.score,
    aiAnnotation: {
      ...stageBase("ANNOTATION_AI" as const),
      summary: correction.score?.feedback ?? "",
      strengths: [],
      improvements,
      checkpointNotes: [],
    },
  };
}

async function loadQuestionContexts(submissionId: string, assessmentId: string): Promise<QuestionContext[]> {
  const [questions, responses] = await Promise.all([
    prisma.question.findMany({
      where: { assessmentId },
      orderBy: { questionNumber: "asc" },
      select: {
        id: true,
        questionNumber: true,
        questionText: true,
        maximumMarks: true,
        rubric: {
          select: {
            activeVersionId: true,
            activeVersion: {
              select: {
                id: true,
                expectedAnswer: true,
                partialCreditGuidance: true,
                markingCheckpoints: true,
                structuredExpectation: true,
              },
            },
          },
        },
      },
    }),
    prisma.questionResponse.findMany({
      where: { submissionId },
      select: { id: true, questionId: true, status: true, studentAnswer: true },
    }),
  ]);

  const responseByQuestionId = new Map(responses.map((response) => [response.questionId, response]));

  return questions.flatMap((question): QuestionContext[] => {
    const response = responseByQuestionId.get(question.id);
    // Only questions the mapping stage actually associated with written content
    // have a response row; the rest were not answered and are not this flow's
    // to invent. Already-finished responses are left exactly as they are.
    if (!response || TERMINAL_STATUSES.includes(response.status)) return [];

    const version = question.rubric?.activeVersion ?? null;
    const studentAnswer = (response.studentAnswer ?? {}) as { sourcePages?: unknown };

    return [
      {
        questionId: question.id,
        questionNumber: question.questionNumber,
        questionText: question.questionText,
        maximumMarks: Number(question.maximumMarks),
        expectedAnswer: version?.expectedAnswer ?? null,
        partialCreditGuidance: version?.partialCreditGuidance ?? null,
        markingCheckpoints: (version?.markingCheckpoints as unknown as RubricMarkingCheckpoint[]) ?? [],
        structuredExpectation: (version?.structuredExpectation as unknown as StructuredExpectation) ?? null,
        rubricVersionId: version?.id ?? null,
        responseId: response.id,
        sourcePages: Array.isArray(studentAnswer.sourcePages)
          ? studentAnswer.sourcePages.filter((page): page is number => typeof page === "number")
          : [],
      },
    ];
  });
}

async function persistCorrection(
  context: QuestionContext,
  correction: MathQuestionCorrection,
  assessmentId: string,
  submissionId: string,
): Promise<void> {
  const status = correction.score ? "GRADED" : "FAILED";

  await prisma.questionResponse.update({
    where: { id: context.responseId },
    data: {
      status,
      gradingResult: buildGradingResult(correction, context.maximumMarks) as unknown as object,
      annotationResult: buildAnnotationResult(correction) as unknown as object,
      // Pin the exact rubric version this was judged against, so the result
      // stays reproducible after the rubric changes — the same guarantee the
      // existing pipeline provides.
      ...(context.rubricVersionId && { rubricVersionUsedId: context.rubricVersionId }),
    },
  });

  // The ONLY thing escalated to a teacher: marking could not be completed at
  // all, even after retries, so there is no mark to show. Everything else the
  // AI settles on its own — an unconfirmed finding is dropped rather than
  // queued, because a student whose paper was read and marked should get their
  // result, not wait behind a teacher's queue for a doubt about which line of
  // their working was wrong.
  if (!correction.score) {
    await createReviewItemIfNeeded({
      reason: "UNDETERMINED_GRADING",
      assessmentId,
      questionId: context.questionId,
      submissionId,
      questionResponseId: context.responseId,
      context: { detail: "Marking could not be completed for this question." },
    });
  }
}

/**
 * Whether this assessment's rubrics can actually be checked question by
 * question — i.e. at least one has a structured expectation the rubric itself
 * judged solvable.
 *
 * Routing is decided by the rubric rather than by the assessment's subject
 * text. Matching subject names failed in practice: "Statistics" is a
 * mathematics paper, but no reasonable subject-name test recognised it, so
 * every such submission silently fell back to keyword matching. The rubric
 * already knows whether a question has one definite checkable answer.
 */
export async function hasCheckableRubric(assessmentId: string): Promise<boolean> {
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { rubric: { select: { activeVersion: { select: { structuredExpectation: true } } } } },
  });

  return questions.some((question) => {
    const expectation = question.rubric?.activeVersion?.structuredExpectation as unknown as
      | StructuredExpectation
      | null;
    return expectation?.solvable === true;
  });
}

export async function runMathCorrectionForSubmission(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, assessmentId: true },
  });
  if (!submission) return;

  const contexts = await loadQuestionContexts(submissionId, submission.assessmentId);
  if (contexts.length === 0) return;

  let pages;
  let readings: Map<number, ReconciledMathReading>;
  try {
    pages = await loadOrderedAnswerSheetPages(submissionId);
    readings = await readMathAnswers(
      pages,
      contexts.map((context) => ({
        questionNumber: context.questionNumber,
        questionText: context.questionText,
      })),
    );
  } catch (error) {
    console.error("Maths correction could not read the answer sheet", error);
    return;
  }

  // Questions are independent: one failing must never hold back the others,
  // matching how the existing handwritten flow runs its per-question work.
  const outcomes = await Promise.allSettled(
    contexts.map(async (context) => {
      const reading = readings.get(context.questionNumber);
      if (!reading) return null;

      const correction = await correctMathQuestion({
        questionId: context.questionId,
        questionNumber: context.questionNumber,
        questionText: context.questionText,
        maximumMarks: context.maximumMarks,
        subject: "Mathematics",
        expectedAnswer: context.expectedAnswer,
        markingCheckpoints: context.markingCheckpoints,
        partialCreditGuidance: context.partialCreditGuidance,
        structuredExpectation: context.structuredExpectation,
        reading,
      });

      await persistCorrection(context, correction, submission.assessmentId, submissionId);
      return { context, correction };
    }),
  );

  const corrected = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" && outcome.value ? [outcome.value] : [],
  );
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error("Maths correction failed for one question", outcome.reason);
    }
  }
  if (corrected.length === 0) return;

  const annotatableQuestions: AnnotatableQuestion[] = corrected.map(({ context, correction }) => ({
    questionNumber: context.questionNumber,
    awardedMarks: correction.score?.awardedMarks ?? 0,
    maximumMarks: context.maximumMarks,
    explanations: correction.explanations,
    sourcePages: context.sourcePages,
  }));

  const total = {
    awarded: annotatableQuestions.reduce((sum, question) => sum + question.awardedMarks, 0),
    maximum: annotatableQuestions.reduce((sum, question) => sum + question.maximumMarks, 0),
  };

  // Best-effort: the marks and written feedback are already saved above, so a
  // failure to draw on the pages must not undo any of it.
  try {
    await annotateAnswerSheet(
      pages.map((page) => ({
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        submissionId,
        buffer: page.buffer,
      })),
      annotatableQuestions,
      total,
    );
  } catch (error) {
    console.error("Answer-sheet annotation failed", error);
  }
}
