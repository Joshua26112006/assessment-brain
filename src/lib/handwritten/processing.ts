import { prisma } from "@/lib/prisma";
import { loadOrderedAnswerSheetPages } from "./pages";
import { runDeterministicValidation } from "./validation";
import { readHandwrittenSubmission } from "./answerReading";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import type { AnswerSheetValidationResult, HandwrittenProcessingResult } from "./types";

/**
 * Processes one handwritten Submission: deterministic validation, the AI
 * answer-sheet validation gate, and global handwriting reading — producing
 * a structured, persisted answer index ready for a LATER evaluation phase
 * (Phase 3.4C).
 *
 * Deliberately does NOT run the existing evaluation pipeline
 * (runPipelineForQuestionResponse), create QuestionResponse rows, calculate
 * marks, or generate feedback — none of that belongs to this phase. This
 * function's entire job ends at "READY for evaluation."
 *
 * Server-only. Never throws — every failure path (missing pages, storage
 * read failure, AI/network failure, malformed AI output) is caught and
 * persisted as SubmissionProcessingStatus.FAILED with a plain-language
 * processingError, mirroring runQuestionPaperExtraction's own contract
 * (src/lib/questionPaperExtraction/index.ts) exactly. Safe to call from a
 * background `after()` task; the caller does not need to catch anything.
 */
export async function processHandwrittenSubmission(
  submissionId: string,
): Promise<HandwrittenProcessingResult> {
  const failure = (processingError: string): HandwrittenProcessingResult => ({
    outcome: "FAILED",
    validationResult: null,
    answerIndex: null,
    processingError,
  });

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true, assessmentId: true },
  });
  if (!submission) {
    return failure("Submission not found.");
  }
  // Defensive: this should only ever run right after a submission moves to
  // SUBMITTED (see submitAnswerSheetsForEvaluation's after()), or — since a
  // technical processing failure now moves Submission to FAILED (see the
  // catch block below) — on a retry of a submission still in that state.
  // NEEDS_REVIEW (set when the AI gate concluded INVALID) is deliberately
  // NOT included: SubmissionProcessing's own INVALID status is terminal by
  // design (retrying the same pages without new information would just
  // waste money), and this guard should agree with that rather than allow
  // a re-entry the atomic claim below would reject anyway. The real,
  // authoritative protection against inappropriate/duplicate reprocessing
  // is that atomic claim, not this status check — this is only a
  // documentary defensive boundary.
  if (submission.status !== "SUBMITTED" && submission.status !== "FAILED") {
    return failure(`Submission is not in a state ready for handwritten processing (status: ${submission.status}).`);
  }

  // Ensure a processing row exists, then atomically claim it. This is the
  // sole duplicate-processing guard: a double-click, a browser/network
  // retry, a second tab, or a repeated API call all resolve to the same
  // submissionId, and only the request whose UPDATE actually matches a
  // PENDING/FAILED row proceeds — everyone else sees `count === 0` and
  // backs off without touching anything. Same compare-and-swap pattern
  // already used twice elsewhere in this codebase (runPipelineForQuestionResponse's
  // claim, and the Phase 3.3 question-paper approval/retry race fixes).
  await prisma.submissionProcessing.upsert({
    where: { submissionId },
    create: { submissionId, status: "PENDING" },
    update: {},
  });
  const claimed = await prisma.submissionProcessing.updateMany({
    where: { submissionId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PROCESSING", processingError: null },
  });
  if (claimed.count === 0) {
    // Already PROCESSING (another request got there first), or already
    // terminal (READY/INVALID) — nothing to do here. Not an error: reflect
    // whatever the current, already-authoritative state actually is rather
    // than reporting a synthetic outcome of our own.
    const existing = await prisma.submissionProcessing.findUnique({
      where: { submissionId },
      select: { status: true, validationResult: true, answerIndex: true, processingError: true },
    });
    return {
      outcome: existing?.status === "READY" || existing?.status === "INVALID" ? existing.status : "FAILED",
      validationResult: (existing?.validationResult as unknown as AnswerSheetValidationResult | null) ?? null,
      answerIndex: (existing?.answerIndex as unknown as HandwrittenProcessingResult["answerIndex"]) ?? null,
      processingError:
        existing?.status === "PROCESSING"
          ? "Handwritten processing is already in progress for this submission."
          : (existing?.processingError ?? null),
    };
  }

  try {
    const questions = await prisma.question.findMany({
      where: { assessmentId: submission.assessmentId },
      orderBy: { questionNumber: "asc" },
      select: { id: true, questionNumber: true, questionText: true },
    });

    const pages = await loadOrderedAnswerSheetPages(submissionId);

    const deterministic = runDeterministicValidation(pages);

    if (deterministic.outcome === "INVALID") {
      // A structural/technical reason to never even ask the AI — no
      // pages, an impossible page arrangement, or a size beyond what this
      // phase will safely process. This is a conclusion the SYSTEM reached
      // before spending anything, not a judgment about the student's work.
      const validationResult: AnswerSheetValidationResult = {
        decision: "INVALID",
        confidence: { value: 1, level: "high" },
        reasonCodes: ["DETERMINISTIC_VALIDATION_FAILED"],
        pageObservations: [],
        warnings: [...deterministic.errors, ...deterministic.warnings],
      };
      await prisma.submissionProcessing.update({
        where: { submissionId },
        data: { status: "INVALID", validationResult: validationResult as unknown as object },
      });
      // A clearly invalid submission must be visible to the owning teacher
      // rather than silently disappearing (Step 6) — never fake-graded,
      // never treated as a technical error. Submission-scoped: there is no
      // single Question or QuestionResponse this is about.
      await createReviewItemIfNeeded({
        reason: "INVALID_ANSWER_SHEET",
        assessmentId: submission.assessmentId,
        submissionId,
        context: { validationResult },
      });
      // Left at SUBMITTED, the student's results page would say "waiting to
      // be marked" indefinitely — untrue, since nothing further happens
      // automatically for an invalid submission. NEEDS_REVIEW is the
      // existing status whose student-facing copy ("your teacher is
      // checking this before it's final") is actually accurate here.
      await prisma.submission
        .update({ where: { id: submissionId }, data: { status: "NEEDS_REVIEW" } })
        .catch(() => {});
      return { outcome: "INVALID", validationResult, answerIndex: null, processingError: null };
    }

    const { validation, answerIndex } = await readHandwrittenSubmission(pages, questions);

    // Fold any deterministic WARNING-level notes into the persisted
    // validation record so they're never silently lost just because the AI
    // gate itself found nothing to add.
    const mergedValidation: AnswerSheetValidationResult = {
      ...validation,
      warnings: [...deterministic.warnings, ...validation.warnings],
    };

    const outcome = mergedValidation.decision === "INVALID" ? "INVALID" : "READY";

    await prisma.submissionProcessing.update({
      where: { submissionId },
      data: {
        status: outcome,
        validationResult: mergedValidation as unknown as object,
        answerIndex: outcome === "READY" ? (answerIndex as unknown as object) : undefined,
      },
    });

    if (outcome === "INVALID") {
      // Same visibility guarantee as the deterministic-INVALID branch above
      // — a conclusion the AI gate reached is just as much a real outcome a
      // teacher needs to see as one the system reached deterministically.
      await createReviewItemIfNeeded({
        reason: "INVALID_ANSWER_SHEET",
        assessmentId: submission.assessmentId,
        submissionId,
        context: { validationResult: mergedValidation },
      });
      // Same reasoning as the deterministic-INVALID branch: SUBMITTED would
      // misleadingly imply marking is still pending.
      await prisma.submission
        .update({ where: { id: submissionId }, data: { status: "NEEDS_REVIEW" } })
        .catch(() => {});
    }

    return {
      outcome,
      validationResult: mergedValidation,
      answerIndex: outcome === "READY" ? answerIndex : null,
      processingError: null,
    };
  } catch (error) {
    // Never persist a raw stack trace or provider error body — a short,
    // plain message only, matching questionPaperExtraction/index.ts.
    const message =
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : "Processing failed unexpectedly. Please try again.";

    await prisma.submissionProcessing
      .update({ where: { submissionId }, data: { status: "FAILED", processingError: message } })
      .catch(() => {
        // The row may have been removed concurrently — nothing left to mark FAILED.
      });

    // A technical failure (storage/AI/network) is not automatically
    // retried anywhere in the current architecture, so it must not go
    // unnoticed — reuses the existing VERIFICATION_FAILURE reason, already
    // used for exactly this kind of "evaluation could not be completed"
    // outcome in the typed-answer pipeline. Idempotent: a second FAILED
    // attempt for the same submission dedupes on {submissionId, reason}
    // and never piles up duplicate review items.
    await createReviewItemIfNeeded({
      reason: "VERIFICATION_FAILURE",
      assessmentId: submission.assessmentId,
      submissionId,
      context: { errorMessage: message },
    });

    // Same "never leave the student staring at a stale SUBMITTED forever"
    // reasoning as the INVALID branches — FAILED is the existing status
    // whose copy ("something went wrong... your teacher has been
    // notified") is exactly true here, and it's what the typed-answer flow
    // already uses for the same kind of technical processing failure.
    await prisma.submission
      .update({ where: { id: submissionId }, data: { status: "FAILED" } })
      .catch(() => {});

    return failure(message);
  }
}
