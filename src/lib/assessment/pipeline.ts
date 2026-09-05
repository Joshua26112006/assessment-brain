import { prisma } from "@/lib/prisma";
import { readAnswer } from "@/lib/answerReading";
import { understandQuestion } from "@/lib/questionUnderstanding";
import { interpretRubric } from "@/lib/rubricInterpretation";
import { correctAnswer } from "@/lib/correction";
import { annotateResponse } from "@/lib/annotation";
import { gradeResponse } from "@/lib/grading";
import { detectNovelApproach } from "@/lib/novelApproach";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import type {
  AnnotationResult,
  CorrectionResult,
  GradingResult,
  NovelApproachDetectionResult,
  PipelineRunResult,
  StageExecutionRecord,
} from "@/types/pipeline";
import type { QuestionResponseId } from "@/types/assessmentBrain";

/**
 * States in which a QuestionResponse has already been fully attempted by
 * the pipeline and should not be recomputed. Widened (Phase 2.2) from the
 * original GRADED-only check: NEEDS_REVIEW and FAILED are equally terminal
 * outcomes (the pipeline's job is done; a human or a deliberate retry is
 * what happens next), and integrating ReviewItem creation exposed the real
 * bug in only treating GRADED this way — a re-triggered NEEDS_REVIEW or
 * FAILED response would otherwise recompute and create a duplicate
 * ReviewItem every time.
 */
const TERMINAL_STATUSES = ["GRADED", "NEEDS_REVIEW", "FAILED"] as const;

/**
 * Server-side only. No route handler exposes this — it must be called from
 * trusted server code (a future submission-processing trigger), never from
 * client input. It never trusts a client-supplied score, rubric id, or
 * QuestionResponse id: everything it operates on is loaded from the
 * database via the response's own id, and every id used afterward (rubric
 * version, checkpoints) comes from that loaded, server-controlled data.
 *
 * Runs the full deterministic evaluation chain for one QuestionResponse:
 *
 *   Answer Reading -> Question Understanding -> Rubric Interpretation
 *     -> Deterministic Correction -> Annotation -> Grading
 *
 * with Novel Approach Detection alongside Correction. See src/types/pipeline.ts
 * for why only Correction/Annotation/Grading are persisted (the earlier
 * stages are cheap, deterministic derivations of already-durable data).
 */
export async function runPipelineForQuestionResponse(
  questionResponseId: QuestionResponseId,
): Promise<PipelineRunResult> {
  const empty = (status: PipelineRunResult["status"], error: string | null = null): PipelineRunResult => ({
    questionResponseId,
    status,
    rubricVersionId: null,
    stageExecutions: [],
    correction: null,
    annotation: null,
    grading: null,
    novelApproach: null,
    novelApproachCandidateCreated: false,
    error,
  });

  const response = await prisma.questionResponse.findUnique({
    where: { id: questionResponseId },
    include: {
      submission: { select: { status: true } },
      question: {
        select: {
          assessmentId: true,
          questionText: true,
          maximumMarks: true,
          rubric: {
            select: {
              activeVersionId: true,
              activeVersion: { select: { id: true, solutionApproaches: true, markingCheckpoints: true } },
            },
          },
        },
      },
      rubricVersionUsed: { select: { id: true, solutionApproaches: true, markingCheckpoints: true } },
    },
  });

  if (!response) {
    return empty("FAILED", "QuestionResponse not found.");
  }

  // The response must belong to a submitted (or later-stage) submission —
  // never evaluate a still-in-progress DRAFT.
  if (response.submission.status === "DRAFT") {
    return empty("BLOCKED_NOT_SUBMITTED");
  }

  // --- Pin the rubric version, exactly once, before any evaluation. ---
  // If already pinned (this response was processed, or partially processed,
  // before), reuse that exact version — never re-fetch "whatever is active
  // now," since the rubric may have changed since. If not yet pinned, pin
  // the current active version atomically: the conditional WHERE clause
  // means a concurrent call that pins first wins, and this call then reads
  // back whatever actually got pinned rather than assuming its own value won.
  let rubricVersion = response.rubricVersionUsed;
  if (!rubricVersion) {
    const activeVersionId = response.question.rubric?.activeVersionId;
    if (!activeVersionId) {
      return empty("BLOCKED_NO_ACTIVE_RUBRIC");
    }

    await prisma.questionResponse.updateMany({
      where: { id: questionResponseId, rubricVersionUsedId: null },
      data: { rubricVersionUsedId: activeVersionId },
    });

    const pinned = await prisma.questionResponse.findUnique({
      where: { id: questionResponseId },
      select: { rubricVersionUsed: { select: { id: true, solutionApproaches: true, markingCheckpoints: true } } },
    });
    rubricVersion = pinned?.rubricVersionUsed ?? response.question.rubric?.activeVersion ?? null;
  }

  if (!rubricVersion) {
    return empty("BLOCKED_NO_ACTIVE_RUBRIC");
  }

  // --- Idempotency / lightweight concurrency guard. ---
  // Already fully attempted (success, needs-review, or failed): don't
  // recompute completed work. See TERMINAL_STATUSES for why this covers
  // more than just GRADED.
  const current = await prisma.questionResponse.findUnique({
    where: { id: questionResponseId },
    select: { status: true, correctionResult: true, annotationResult: true, gradingResult: true },
  });
  if (current && (TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
    return {
      ...empty("SKIPPED_ALREADY_GRADED"),
      rubricVersionId: rubricVersion.id,
      correction: (current.correctionResult as unknown as CorrectionResult) ?? null,
      annotation: (current.annotationResult as unknown as AnnotationResult) ?? null,
      grading: (current.gradingResult as unknown as GradingResult) ?? null,
    };
  }

  // Claim this run atomically. Using the existing QuestionResponseStatus
  // enum as a simple advisory lock: if another run already claimed it (or
  // finished it) between our read above and now, this update affects zero
  // rows and we back off rather than racing a concurrent evaluation.
  //
  // Known limitation: there's no dedicated pipeline-run table, so a process
  // that crashes mid-run leaves the response stuck at CORRECTING with no
  // automatic recovery. Acceptable for this foundation phase (no background
  // job infrastructure exists yet); documented rather than silently ignored.
  const claimed = await prisma.questionResponse.updateMany({
    where: { id: questionResponseId, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { status: "CORRECTING" },
  });
  if (claimed.count === 0) {
    return { ...empty("SKIPPED_ALREADY_GRADED"), rubricVersionId: rubricVersion.id };
  }

  const stageExecutions: StageExecutionRecord[] = [];

  try {
    const answerReadingResult = timeStage(stageExecutions, "ANSWER_READING", () =>
      readAnswer({ rawAnswer: response.studentAnswer }),
    );

    timeStage(stageExecutions, "QUESTION_UNDERSTANDING", () =>
      understandQuestion({
        questionText: response.question.questionText,
        maximumMarks: Number(response.question.maximumMarks),
      }),
    );

    const rubricInterpretationResult = timeStage(stageExecutions, "RUBRIC_INTERPRETATION", () =>
      interpretRubric({
        rubricVersionId: rubricVersion.id,
        solutionApproaches: rubricVersion.solutionApproaches,
        markingCheckpoints: rubricVersion.markingCheckpoints,
      }),
    );

    const correctionResult = timeStage(stageExecutions, "DETERMINISTIC_CORRECTION", () =>
      correctAnswer({
        rubricVersionId: rubricVersion.id,
        normalizedAnswerText: answerReadingResult.normalizedText,
        checkpoints: rubricInterpretationResult.checkpoints,
      }),
    );

    const annotationResult = timeStage(stageExecutions, "ANNOTATION", () =>
      annotateResponse({ checkpointResults: correctionResult.checkpointResults }),
    );

    const gradingResult = timeStage(stageExecutions, "GRADING", () =>
      gradeResponse({
        correctionTotal: correctionResult.correctionTotal,
        maximumMarks: Number(response.question.maximumMarks),
        needsHumanReview: annotationResult.needsHumanReview,
      }),
    );

    // Novel approach detection runs alongside correction and must never
    // break the main grading result if it fails.
    let novelApproachResult: NovelApproachDetectionResult | null = null;
    let novelApproachCandidateCreated = false;
    try {
      novelApproachResult = timeStage(stageExecutions, "NOVEL_APPROACH_DETECTION", () =>
        detectNovelApproach({
          normalizedAnswerText: answerReadingResult.normalizedText,
          knownApproaches: rubricInterpretationResult.approaches,
        }),
      );

      if (novelApproachResult.isNovel && novelApproachResult.confidence.level !== "low") {
        // A candidate for teacher review — never an automatic rubric change.
        await prisma.novelApproachCandidate.create({
          data: {
            questionResponseId,
            rubricVersionId: rubricVersion.id,
            approachData: novelApproachResult as unknown as object,
          },
        });
        novelApproachCandidateCreated = true;

        // Surface the candidate through the existing teacher review
        // workflow — otherwise it would only ever be visible by querying
        // NovelApproachCandidate directly, which no UI does.
        await createReviewItemIfNeeded({
          reason: "NOVEL_APPROACH",
          assessmentId: response.question.assessmentId,
          questionId: response.questionId,
          submissionId: response.submissionId,
          questionResponseId,
          context: { novelApproach: novelApproachResult },
        });
      }
    } catch (novelApproachError) {
      stageExecutions.push({
        stage: "NOVEL_APPROACH_DETECTION",
        outcome: "FAILED",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        warnings: [errorMessage(novelApproachError)],
      });
    }

    const finalStatus = gradingResult.outcome === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "GRADED";

    await prisma.questionResponse.update({
      where: { id: questionResponseId },
      data: {
        status: finalStatus,
        correctionResult: correctionResult as unknown as object,
        annotationResult: annotationResult as unknown as object,
        gradingResult: gradingResult as unknown as object,
      },
    });

    if (finalStatus === "NEEDS_REVIEW") {
      await createReviewItemIfNeeded({
        reason: "UNCERTAIN_CORRECTION",
        assessmentId: response.question.assessmentId,
        questionId: response.questionId,
        submissionId: response.submissionId,
        questionResponseId,
        context: { annotation: annotationResult, correctionTotal: correctionResult.correctionTotal },
      });
    }

    return {
      questionResponseId,
      status: finalStatus === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "COMPLETED",
      rubricVersionId: rubricVersion.id,
      stageExecutions,
      correction: correctionResult,
      annotation: annotationResult,
      grading: gradingResult,
      novelApproach: novelApproachResult,
      novelApproachCandidateCreated,
      error: null,
    };
  } catch (error) {
    const message = errorMessage(error);
    // Best-effort status persistence — don't let a logging failure mask the real error.
    await prisma.questionResponse
      .update({ where: { id: questionResponseId }, data: { status: "FAILED" } })
      .catch(() => {});

    // A processing failure is exactly what ReviewReason.VERIFICATION_FAILURE
    // exists for — surface it to the owning teacher rather than only
    // leaving it as an opaque FAILED status the student sees.
    await createReviewItemIfNeeded({
      reason: "VERIFICATION_FAILURE",
      assessmentId: response.question.assessmentId,
      questionId: response.questionId,
      submissionId: response.submissionId,
      questionResponseId,
      context: { errorMessage: message },
    });

    return {
      questionResponseId,
      status: "FAILED",
      rubricVersionId: rubricVersion.id,
      stageExecutions,
      correction: null,
      annotation: null,
      grading: null,
      novelApproach: null,
      novelApproachCandidateCreated: false,
      error: message,
    };
  }
}

function timeStage<TOutput extends { warnings: string[] }>(
  executions: StageExecutionRecord[],
  stage: StageExecutionRecord["stage"],
  run: () => TOutput,
): TOutput {
  const startedAt = new Date().toISOString();
  const result = run();
  executions.push({
    stage,
    outcome: "COMPLETED",
    startedAt,
    finishedAt: new Date().toISOString(),
    warnings: result.warnings,
  });
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown pipeline error.";
}
