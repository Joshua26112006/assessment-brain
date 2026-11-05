import type { QuestionResponseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { holdForUnapprovedScheme, mayMarkAgainst } from "@/lib/assessment/schemeGate";
import { loadOrderedAnswerSheetPages } from "@/lib/handwritten/pages";
import { readStructuredAnswers } from "@/lib/structuredCorrection/structuredReading";
import { correctStructuredQuestion, type StructuredQuestionCorrection } from "@/lib/structuredCorrection/pipeline";
import { PIPELINE_CONTRACT_VERSION } from "@/types/pipeline";
import type { AnnotationResult, GradingResult } from "@/types/pipeline";
import type { ReconciledReading, StoredFinding, StructuredExpectation } from "@/types/structuredCorrection";
import type { RubricMarkingCheckpoint } from "@/types/rubricGeneration";

/**
 * Runs the structured correction flow for one handwritten submission and
 * writes the results into the SAME QuestionResponse fields the existing
 * evaluation pipeline uses, so every teacher and student screen renders them
 * without changing a line of UI.
 *
 * Only ever reached for an assessment with at least one checkable rubric
 * (see hasCheckableRubric / evaluateHandwrittenSubmission). Every other
 * assessment continues down the existing per-question pipeline untouched.
 *
 * Never throws. A submission that cannot be read at all is left for the
 * existing flow to report; per-question failures are recorded as review items
 * rather than silently becoming a zero.
 */

/** Statuses meaning a response has already been fully attempted — never recomputed. */
const TERMINAL_STATUSES: QuestionResponseStatus[] = ["GRADED", "NEEDS_REVIEW", "FAILED"];

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
  /** A teacher has approved this question's scheme (decision D8). Nothing is marked against one that is not. */
  schemeApproved: boolean;
  responseId: string;
  sourcePages: number[];
  /** What the answer-mapping stage found written for this question. */
  mappedText: string;
}

function stageBase<T extends string>(stage: T) {
  return {
    stage,
    contractVersion: PIPELINE_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    warnings: [] as string[],
  };
}

function buildGradingResult(correction: StructuredQuestionCorrection, maximumMarks: number): GradingResult {
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
function buildAnnotationResult(correction: StructuredQuestionCorrection): AnnotationResult {
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
                approvedAt: true,
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
    const studentAnswer = (response.studentAnswer ?? {}) as { sourcePages?: unknown; text?: unknown };

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
        schemeApproved: mayMarkAgainst(version),
        responseId: response.id,
        sourcePages: Array.isArray(studentAnswer.sourcePages)
          ? studentAnswer.sourcePages.filter((page): page is number => typeof page === "number")
          : [],
        mappedText: typeof studentAnswer.text === "string" ? studentAnswer.text.trim() : "",
      },
    ];
  });
}

async function persistCorrection(
  context: QuestionContext,
  correction: StructuredQuestionCorrection,
  assessmentId: string,
  submissionId: string,
): Promise<void> {
  const status = correction.score ? "GRADED" : "FAILED";

  // The response and the record of the AI's own mark are written together, so
  // the audit trail always starts from what the AI actually decided.
  await prisma.$transaction(async (tx) => {
    // Conditional on the answer not already being finished: if a teacher dealt
    // with it while the AI was still working, the late AI result must not
    // overwrite their decision (and no AI_DRAFT is recorded for a mark that
    // was never stored).
    const written = await tx.questionResponse.updateMany({
      where: { id: context.responseId, status: { notIn: TERMINAL_STATUSES } },
      data: {
        status,
        gradingResult: buildGradingResult(correction, context.maximumMarks) as unknown as object,
        annotationResult: buildAnnotationResult(correction) as unknown as object,
        // What the reading extracted and what the comparison concluded from it.
        // Persisted because without it there is no way to answer "why was nothing
        // marked on this page" after the fact — the stages are AI calls whose
        // inputs cannot be reconstructed from a rerun, and diagnosing a real
        // submission previously meant re-running the whole read to guess.
        correctionResult: {
          reading: {
            attempted: correction.reading.attempted,
            agreementConfidence: correction.reading.agreementConfidence,
            structureConfidence: correction.reading.structureConfidence,
            problemType: correction.reading.problemType,
            variables: Object.fromEntries(
              Object.entries(correction.reading.variables).map(([name, value]) => [name, value.raw]),
            ),
            studentAnswer: correction.reading.studentAnswer?.raw ?? null,
          },
          comparison: correction.comparison,
          verificationStatus: correction.verification?.status ?? null,
          explanationCount: correction.explanations.length,
          // Stored so a teacher can keep or remove each one (decision D5); until
          // they do, none of them reaches the student's marked copy.
          findings: correction.explanations.map(
            (explanation): StoredFinding => ({
              id: explanation.errorId,
              type: explanation.explanationType,
              explanation: explanation.explanation,
              wrongText: explanation.wrongText ?? null,
              correctVersion: explanation.correctVersion ?? null,
            }),
          ),
        } as unknown as object,
        // Pin the exact rubric version this was judged against, so the result
        // stays reproducible after the rubric changes — the same guarantee the
        // existing pipeline provides.
        ...(context.rubricVersionId && { rubricVersionUsedId: context.rubricVersionId }),
      },
    });
    if (written.count === 0) return;
    if (correction.score) {
      await tx.markEvent.create({
        data: {
          kind: "AI_DRAFT",
          submissionId,
          questionResponseId: context.responseId,
          marks: correction.score.awardedMarks,
          payload: {
            flow: "structured",
            maximumMarks: context.maximumMarks,
            findings: correction.explanations.length,
            verificationStatus: correction.verification?.status ?? null,
          },
        },
      });
    }
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

type ConflictKind = "not_attempted" | "missing" | "reader_failed" | "question_failed";

const CONFLICT_DETAIL: Record<ConflictKind, string> = {
  missing: "Writing was found for this question, but it could not be read for marking.",
  not_attempted: "Writing was found for this question, but the marking read found no answer.",
  reader_failed: "The answer sheet could not be read for marking, so this question has no draft mark.",
  question_failed: "Marking this question failed unexpectedly, so it has no draft mark.",
};

/**
 * Records that this question cannot be marked automatically — the two reading
 * stages disagree about whether it was answered, the sheet could not be read,
 * or the marking itself failed — and hands it to a teacher rather than guessing
 * a mark. Without this, the response stayed pending forever and the whole
 * submission sat in PROCESSING with nothing in any teacher's queue.
 *
 * Never throws: it runs on failure paths, and a failure to record the failure
 * must not hide the original one or stop the other questions being flagged.
 */
async function flagReadingConflict(
  context: QuestionContext,
  assessmentId: string,
  submissionId: string,
  kind: ConflictKind,
): Promise<void> {
  try {
    await prisma.questionResponse.update({
      where: { id: context.responseId },
      data: { status: "NEEDS_REVIEW" },
    });
    await createReviewItemIfNeeded({
      reason: "AMBIGUOUS_EXTRACTION",
      assessmentId,
      questionId: context.questionId,
      submissionId,
      questionResponseId: context.responseId,
      context: {
        detail: CONFLICT_DETAIL[kind],
        mappedTextSample: context.mappedText.slice(0, 200),
        sourcePages: context.sourcePages,
      },
    });
  } catch (error) {
    console.error("Could not flag a question for teacher review", error);
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

export async function runStructuredCorrectionForSubmission(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, assessmentId: true, assessment: { select: { subject: true } } },
  });
  if (!submission) return;

  const allContexts = await loadQuestionContexts(submissionId, submission.assessmentId);

  // Nothing is marked against a scheme no teacher has approved (decision D8). Those answers are
  // parked for the teacher with a clear reason and are picked up again when the scheme is approved.
  const held = allContexts.filter((context) => !context.schemeApproved);
  await Promise.all(
    held.map((context) =>
      holdForUnapprovedScheme({
        responseId: context.responseId,
        assessmentId: submission.assessmentId,
        submissionId,
        questionId: context.questionId,
      }),
    ),
  );
  const contexts = allContexts.filter((context) => context.schemeApproved);
  if (contexts.length === 0) return;

  let pages;
  let readings: Map<number, ReconciledReading>;
  try {
    pages = await loadOrderedAnswerSheetPages(submissionId);
    readings = await readStructuredAnswers(
      pages,
      contexts.map((context) => ({
        questionNumber: context.questionNumber,
        questionText: context.questionText,
      })),
    );
  } catch (error) {
    console.error("Structured correction could not read the answer sheet", error);
    await Promise.all(
      contexts.map((context) => flagReadingConflict(context, submission.assessmentId, submissionId, "reader_failed")),
    );
    return;
  }

  // Questions are independent: one failing must never hold back the others,
  // matching how the existing handwritten flow runs its per-question work.
  const outcomes = await Promise.allSettled(
    contexts.map(async (context) => {
      const reading = readings.get(context.questionNumber);
      // The mapping stage found writing for this question, but the reader either
      // returned nothing for it or says it was never attempted. One of the two
      // is wrong, and marking it 0 would silently take marks from a student who
      // may have answered — so a teacher decides instead.
      if (!reading || (!reading.attempted && context.mappedText)) {
        await flagReadingConflict(context, submission.assessmentId, submissionId, reading ? "not_attempted" : "missing");
        return null;
      }

      const correction = await correctStructuredQuestion({
        questionId: context.questionId,
        questionNumber: context.questionNumber,
        questionText: context.questionText,
        maximumMarks: context.maximumMarks,
        subject: submission.assessment.subject,
        expectedAnswer: context.expectedAnswer,
        markingCheckpoints: context.markingCheckpoints,
        partialCreditGuidance: context.partialCreditGuidance,
        structuredExpectation: context.structuredExpectation,
        reading,
      });

      await persistCorrection(context, correction, submission.assessmentId, submissionId);
      return null;
    }),
  );

  // A question that threw has no mark and would otherwise stay pending for
  // good. outcomes[i] belongs to contexts[i].
  await Promise.all(
    outcomes.map(async (outcome, index) => {
      if (outcome.status !== "rejected") return;
      console.error("Structured correction failed for one question", outcome.reason);
      await flagReadingConflict(contexts[index], submission.assessmentId, submissionId, "question_failed");
    }),
  );
  // Nothing is drawn on the pages here. The marked copy is made when a teacher releases the
  // submission (src/lib/assessment/markedCopy.ts), from the marks they settled on and only the
  // findings they kept — drawing it now would show the AI's marks, whatever the teacher decides.
}
