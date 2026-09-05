import { prisma } from "@/lib/prisma";
import { readAnswer } from "@/lib/answerReading";
import { readAnswerWithAi } from "@/lib/answerReading/ai";
import { understandQuestion } from "@/lib/questionUnderstanding";
import { understandQuestionWithAi } from "@/lib/questionUnderstanding/ai";
import { interpretRubric } from "@/lib/rubricInterpretation";
import { interpretRubricWithAi } from "@/lib/rubricInterpretation/ai";
import { applyVerifiedOutcomes, correctAnswer } from "@/lib/correction";
import { evaluateIndependently } from "@/lib/correction/independentEvaluation";
import { compareCheckpoints } from "@/lib/correction/comparison";
import { verifyDisagreements } from "@/lib/correction/verification";
import { annotateResponse, checkpointNeedsReview } from "@/lib/annotation";
import { annotateWithAi } from "@/lib/annotation/ai";
import { gradeResponse } from "@/lib/grading";
import { detectNovelApproach } from "@/lib/novelApproach";
import { detectNovelApproachWithAi } from "@/lib/novelApproach/ai";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import type {
  AiAnnotationResult,
  AiNovelApproachResult,
  AiQuestionUnderstandingResult,
  AiRubricInterpretationResult,
  AiVerificationResult,
  AnnotationResult,
  CorrectionResult,
  GradingResult,
  IndependentAiEvaluationResult,
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
 * Phase 2.1 established a purely deterministic chain:
 *
 *   Answer Reading -> Question Understanding -> Rubric Interpretation
 *     -> Deterministic Correction -> Annotation -> Grading
 *
 * Phase 2.2 layers real AI reasoning (via OpenRouter, src/lib/ai/) onto
 * this WITHOUT replacing it:
 *
 *   Answer Reading (+ optional AI enrichment)
 *     -> Question Understanding (+ optional AI enrichment)
 *     -> Rubric Interpretation (+ optional AI clarification)
 *     -> Deterministic Correction
 *     -> Independent AI Evaluation (only if there's something to evaluate)
 *     -> Deterministic Comparison (pure — no AI call)
 *     -> AI Verification (only if Comparison found real disagreement)
 *     -> resolve final checkpoint outcomes (deterministic function,
 *        applies verification where available, keeps deterministic
 *        evidence otherwise)
 *     -> Grading (deterministic — the only place a final mark is decided)
 *     -> Annotation (+ optional AI-written feedback, grounded in the
 *        already-decided outcome)
 *     -> Novel Approach Detection (+ optional AI opinion, never the gate)
 *
 * Every AI call is optional and independently fault-tolerant: a failure
 * anywhere in the AI-assisted layer falls back to the Phase 2.1
 * deterministic result for that piece, never the whole response. See
 * src/types/pipeline.ts for why only Correction/Annotation/Grading are
 * persisted (the earlier stages, deterministic or AI, are recomputed fresh
 * each run rather than cached in a new column).
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
  // recompute completed work — and, since this now involves real AI
  // spend, avoiding an unnecessary recompute matters more than it did in
  // Phase 2.1. See TERMINAL_STATUSES for why this covers more than GRADED.
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
  // rows and we back off rather than racing a concurrent evaluation (and,
  // now, racing duplicate AI spend).
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
  const maximumMarks = Number(response.question.maximumMarks);

  try {
    // --- 1. Answer Reading (deterministic, source of truth) ---
    const answerReadingResult = await timeStage(stageExecutions, "ANSWER_READING", () =>
      readAnswer({ rawAnswer: response.studentAnswer }),
    );

    // AI enrichment only for a genuinely non-blank, well-formed answer —
    // a blank/unreadable answer is already fully and correctly handled
    // deterministically, so an AI call would just be wasted spend (Step 15).
    const aiAnswerReading =
      answerReadingResult.status === "READ"
        ? await tryAiStage(stageExecutions, "ANSWER_READING_AI", () =>
            readAnswerWithAi({
              questionText: response.question.questionText,
              normalizedAnswerText: answerReadingResult.normalizedText,
            }),
          )
        : null;

    // --- 2. Question Understanding (deterministic, source of truth) ---
    // Not threaded into later stages (matches Phase 2.1: Correction only
    // ever consumed rubric checkpoints + normalized answer text, not this
    // stage's output) — still run for its own contract/observability value.
    await timeStage(stageExecutions, "QUESTION_UNDERSTANDING", () =>
      understandQuestion({
        questionText: response.question.questionText,
        maximumMarks,
      }),
    );

    const aiQuestionUnderstanding = await tryAiStage(stageExecutions, "QUESTION_UNDERSTANDING_AI", () =>
      understandQuestionWithAi({ questionText: response.question.questionText, maximumMarks }),
    );

    // --- 3. Rubric Interpretation (deterministic, source of truth) ---
    const rubricInterpretationResult = await timeStage(stageExecutions, "RUBRIC_INTERPRETATION", () =>
      interpretRubric({
        rubricVersionId: rubricVersion.id,
        solutionApproaches: rubricVersion.solutionApproaches,
        markingCheckpoints: rubricVersion.markingCheckpoints,
      }),
    );

    const aiRubricInterpretation =
      rubricInterpretationResult.checkpoints.length > 0
        ? await tryAiStage(stageExecutions, "RUBRIC_INTERPRETATION_AI", () =>
            interpretRubricWithAi({
              questionText: response.question.questionText,
              checkpoints: rubricInterpretationResult.checkpoints,
            }),
          )
        : null;

    // --- 4. Deterministic Correction (unchanged Phase 2.1 evidence engine) ---
    const correctionResult = await timeStage(stageExecutions, "DETERMINISTIC_CORRECTION", () =>
      correctAnswer({
        rubricVersionId: rubricVersion.id,
        normalizedAnswerText: answerReadingResult.normalizedText,
        checkpoints: rubricInterpretationResult.checkpoints,
      }),
    );

    // --- 5. Independent AI Evaluation — only if there's something real to evaluate. ---
    const canEvaluate = answerReadingResult.status === "READ" && rubricInterpretationResult.checkpoints.length > 0;
    const aiEvaluation: IndependentAiEvaluationResult | null = canEvaluate
      ? await tryAiStage(stageExecutions, "INDEPENDENT_AI_EVALUATION", () =>
          evaluateIndependently({
            questionText: response.question.questionText,
            normalizedAnswerText: answerReadingResult.normalizedText,
            checkpoints: rubricInterpretationResult.checkpoints,
            maximumMarks,
          }),
        )
      : null;

    // --- 6. Deterministic Comparison — pure, always computed, no AI call. ---
    const comparisonResult = await timeStage(stageExecutions, "DETERMINISTIC_COMPARISON", () =>
      compareCheckpoints(correctionResult.checkpointResults, aiEvaluation?.checkpointEvaluations ?? null),
    );

    // --- 7. AI Verification — only when Comparison found something worth adjudicating. ---
    const verification: AiVerificationResult | null =
      comparisonResult.disagreementCount > 0
        ? await tryAiStage(stageExecutions, "AI_VERIFICATION", () =>
            verifyDisagreements({
              questionText: response.question.questionText,
              normalizedAnswerText: answerReadingResult.normalizedText,
              deterministicResults: correctionResult.checkpointResults,
              comparisons: comparisonResult.checkpointComparisons,
            }),
          )
        : null;

    // --- 8. Resolve final checkpoint outcomes (deterministic function). ---
    const resolved = applyVerifiedOutcomes(
      correctionResult.checkpointResults,
      verification?.checkpointVerifications ?? null,
    );
    const deterministicNeedsReview = resolved.checkpoints.some(checkpointNeedsReview);
    const needsHumanReview = verification
      ? verification.requiresReview || resolved.anyNeedsReview
      : deterministicNeedsReview;
    const evidenceSource = verification ? "AI_VERIFIED" : "DETERMINISTIC";

    // --- 9. Grading — deterministic, the ONLY place a final mark is decided. ---
    const gradingResult = await timeStage(stageExecutions, "GRADING", () =>
      gradeResponse({
        correctionTotal: resolved.total,
        maximumMarks,
        needsHumanReview,
        evidenceSource,
      }),
    );

    // --- 10. Annotation (deterministic) — now explains the resolved/graded outcome. ---
    const annotationResult = await timeStage(stageExecutions, "ANNOTATION", () =>
      annotateResponse({ checkpointResults: resolved.checkpoints }),
    );

    // Skip the AI-written feedback call for a blank answer — nothing
    // substantive to give feedback on beyond what deterministic annotation
    // already says.
    const aiAnnotation: AiAnnotationResult | null =
      answerReadingResult.status !== "BLANK"
        ? await tryAiStage(stageExecutions, "ANNOTATION_AI", () =>
            annotateWithAi({
              questionText: response.question.questionText,
              normalizedAnswerText: answerReadingResult.normalizedText,
              resolvedCheckpoints: resolved.checkpoints,
              awardedMarks: gradingResult.awardedMarks,
              maximumMarks,
            }),
          )
        : null;

    // --- Assemble the persisted (extended) correction/annotation results. ---
    const persistedCorrectionResult: CorrectionResult = {
      ...correctionResult,
      aiContext: {
        answerReading: aiAnswerReading,
        questionUnderstanding: aiQuestionUnderstanding as AiQuestionUnderstandingResult | null,
        rubricInterpretation: aiRubricInterpretation as AiRubricInterpretationResult | null,
      },
      aiEvaluation,
      comparison: comparisonResult,
      verification,
      resolvedCheckpointResults: resolved.checkpoints,
      resolvedCorrectionTotal: resolved.total,
    };

    const persistedAnnotationResult: AnnotationResult = {
      ...annotationResult,
      aiAnnotation,
    };

    const finalStatus = gradingResult.outcome === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "GRADED";

    await prisma.questionResponse.update({
      where: { id: questionResponseId },
      data: {
        status: finalStatus,
        correctionResult: persistedCorrectionResult as unknown as object,
        annotationResult: persistedAnnotationResult as unknown as object,
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
        context: {
          annotation: persistedAnnotationResult,
          correctionTotal: resolved.total,
          evidenceSource,
        },
      });
    }

    // --- 11. Novel Approach Detection (deterministic gate, unchanged rules). ---
    let novelApproachResult: NovelApproachDetectionResult | null = null;
    let novelApproachCandidateCreated = false;
    try {
      novelApproachResult = await timeStage(stageExecutions, "NOVEL_APPROACH_DETECTION", () =>
        detectNovelApproach({
          normalizedAnswerText: answerReadingResult.normalizedText,
          knownApproaches: rubricInterpretationResult.approaches,
        }),
      );

      // AI opinion is attached as context only — it can never widen or
      // substitute for the deterministic gate below.
      const aiNovelApproach: AiNovelApproachResult | null =
        novelApproachResult.isNovel && answerReadingResult.status === "READ"
          ? await tryAiStage(stageExecutions, "NOVEL_APPROACH_AI", () =>
              detectNovelApproachWithAi({
                questionText: response.question.questionText,
                normalizedAnswerText: answerReadingResult.normalizedText,
                knownApproaches: rubricInterpretationResult.approaches,
              }),
            )
          : null;

      if (novelApproachResult.isNovel && novelApproachResult.confidence.level !== "low") {
        // A candidate for teacher review — never an automatic rubric change.
        const persistedNovelApproachResult: NovelApproachDetectionResult = {
          ...novelApproachResult,
          aiAssistance: aiNovelApproach,
        };

        await prisma.novelApproachCandidate.create({
          data: {
            questionResponseId,
            rubricVersionId: rubricVersion.id,
            approachData: persistedNovelApproachResult as unknown as object,
          },
        });
        novelApproachCandidateCreated = true;
        novelApproachResult = persistedNovelApproachResult;

        // Surface the candidate through the existing teacher review
        // workflow — otherwise it would only ever be visible by querying
        // NovelApproachCandidate directly, which no UI does.
        await createReviewItemIfNeeded({
          reason: "NOVEL_APPROACH",
          assessmentId: response.question.assessmentId,
          questionId: response.questionId,
          submissionId: response.submissionId,
          questionResponseId,
          context: { novelApproach: persistedNovelApproachResult },
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

    return {
      questionResponseId,
      status: finalStatus === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "COMPLETED",
      rubricVersionId: rubricVersion.id,
      stageExecutions,
      correction: persistedCorrectionResult,
      annotation: persistedAnnotationResult,
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

/** For deterministic (never-throwing) stages: times execution and records a COMPLETED entry. */
async function timeStage<TOutput extends { warnings: string[] }>(
  executions: StageExecutionRecord[],
  stage: StageExecutionRecord["stage"],
  run: () => TOutput | Promise<TOutput>,
): Promise<TOutput> {
  const startedAt = new Date().toISOString();
  const result = await run();
  executions.push({
    stage,
    outcome: "COMPLETED",
    startedAt,
    finishedAt: new Date().toISOString(),
    warnings: result.warnings,
  });
  return result;
}

/**
 * For optional AI-assisted stages: never throws out of this function. On
 * failure (network error, retry exhaustion, malformed/unvalidatable JSON —
 * see src/lib/ai/), records a FAILED stage execution with the failure
 * message as a warning and returns null so the caller falls back to
 * deterministic behavior. This is the single place Step 14's "AI failures
 * must not break the pipeline" is enforced structurally.
 */
async function tryAiStage<TOutput extends { warnings: string[] }>(
  executions: StageExecutionRecord[],
  stage: StageExecutionRecord["stage"],
  run: () => Promise<TOutput>,
): Promise<TOutput | null> {
  const startedAt = new Date().toISOString();
  try {
    const result = await run();
    executions.push({
      stage,
      outcome: "COMPLETED",
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings: result.warnings,
    });
    return result;
  } catch (error) {
    executions.push({
      stage,
      outcome: "FAILED",
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings: [errorMessage(error)],
    });
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown pipeline error.";
}
