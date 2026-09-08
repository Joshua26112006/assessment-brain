import { prisma } from "@/lib/prisma";
import { runPipelineForQuestionResponse } from "@/lib/assessment/pipeline";
import { recalculateSubmissionStatus } from "@/lib/assessment/submissionStatusSync";
import { createReviewItemIfNeeded } from "@/lib/assessment/pipelineReviewItems";
import { isMathematicsSubject } from "@/lib/rubricGeneration/structuredExpectation";
import { runMathCorrectionForSubmission } from "@/lib/mathCorrection/submission";
import type { AnswerIndexEntry, AnswerSheetValidationResult, StructuredAnswerIndex } from "./types";

/**
 * Phase 3.4C: turns a READY SubmissionProcessing result into real
 * QuestionResponse rows and hands them to the EXISTING, UNMODIFIED
 * evaluation pipeline (runPipelineForQuestionResponse) — the same function
 * the typed-answer flow already uses. This file contains no evaluation
 * logic of its own: its entire job is normalizing already-read handwritten
 * content into the shape the pipeline already understands, then getting out
 * of the way.
 *
 * Deliberately a separate function from processHandwrittenSubmission
 * (Phase 3.4A/3.4B), called only after that one returns outcome "READY" —
 * keeps "read the document" and "evaluate the mapped answers" as two
 * independently-reasoned-about steps, matching the project's existing
 * pattern of small, single-responsibility modules.
 */
export async function evaluateHandwrittenSubmission(submissionId: string): Promise<void> {
  const processing = await prisma.submissionProcessing.findUnique({
    where: { submissionId },
    select: { status: true, answerIndex: true, validationResult: true },
  });
  // Only a READY result with an actual answer index is evaluation-ready.
  // PENDING/PROCESSING/FAILED have nothing to evaluate yet; INVALID must
  // never reach here at all (enforced by the caller only invoking this on
  // outcome === "READY", and re-checked here as a defensive boundary).
  if (!processing || processing.status !== "READY" || !processing.answerIndex) {
    return;
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, assessmentId: true, assessment: { select: { subject: true } } },
  });
  if (!submission) return;
  const assessmentSubject = submission.assessment.subject;

  const answerIndex = processing.answerIndex as unknown as StructuredAnswerIndex;
  const validationResult = processing.validationResult as unknown as AnswerSheetValidationResult | null;

  const mappedEntries = answerIndex.entries.filter(
    (entry): entry is AnswerIndexEntry & { questionId: string } => entry.questionId !== null,
  );
  const unmappedEntries = answerIndex.entries.filter((entry) => entry.questionId === null);

  // Submission-level signal: an overall-uncertain validation decision, any
  // content that couldn't be mapped to a question, or — the most serious
  // case — a validly-uploaded answer sheet that nonetheless produced zero
  // usable mapped answers. All three are extraction/mapping ambiguity at
  // the SUBMISSION level (not about any one question), so they share the
  // same existing, pre-designed-for-exactly-this reason: AMBIGUOUS_EXTRACTION
  // ("The answer was hard to read or extract.").
  const needsSubmissionLevelFlag =
    validationResult?.decision === "UNCERTAIN" || unmappedEntries.length > 0 || mappedEntries.length === 0;
  if (needsSubmissionLevelFlag) {
    await createReviewItemIfNeeded({
      reason: "AMBIGUOUS_EXTRACTION",
      assessmentId: submission.assessmentId,
      submissionId,
      context: {
        decision: validationResult?.decision ?? null,
        mappedCount: mappedEntries.length,
        unmappedCount: unmappedEntries.length,
        unmappedSamples: unmappedEntries.slice(0, 5).map((entry) => ({
          text: entry.text.slice(0, 200),
          sourcePages: entry.sourcePages,
          detectedQuestionNumber: entry.detectedQuestionNumber,
        })),
      },
    });
  }

  if (mappedEntries.length === 0) {
    // Nothing could be confidently associated with any question — a
    // valid-looking answer sheet that produced no gradable answers is
    // itself worth a teacher's attention, never silently left at a stale
    // SUBMITTED forever and never force-evaluated against nothing.
    await prisma.submission.update({ where: { id: submissionId }, data: { status: "NEEDS_REVIEW" } });
    return;
  }

  // Mirrors submitAssessment's own background block exactly: mark
  // PROCESSING before running per-question evaluation, so the student sees
  // an honest "being evaluated" state rather than a stale SUBMITTED.
  await prisma.submission.update({ where: { id: submissionId }, data: { status: "PROCESSING" } });

  const questionResponseIds: string[] = [];
  for (const entry of mappedEntries) {
    // Idempotent by construction: upsert with an empty `update` means an
    // already-existing QuestionResponse (a prior processing attempt, a
    // retried background task) is NEVER overwritten — its studentAnswer,
    // status, and any already-computed grading/correction/annotation
    // results are left completely untouched. Mirrors the exact same
    // upsert-with-noop-update idiom this phase's own SubmissionProcessing
    // claim already uses.
    const response = await prisma.questionResponse.upsert({
      where: { submissionId_questionId: { submissionId, questionId: entry.questionId } },
      create: {
        submissionId,
        questionId: entry.questionId,
        studentAnswer: buildHandwrittenStudentAnswer(entry),
      },
      update: {},
      select: { id: true },
    });
    questionResponseIds.push(response.id);

    // Flag genuinely uncertain readings/mappings for teacher attention.
    // Idempotent via createReviewItemIfNeeded's own {questionResponseId,
    // reason} dedupe — safe to call every time this function runs for this
    // submission, never creates more than one such item per response.
    if (entry.uncertain) {
      await createReviewItemIfNeeded({
        reason: "AMBIGUOUS_EXTRACTION",
        assessmentId: submission.assessmentId,
        questionId: entry.questionId,
        submissionId,
        questionResponseId: response.id,
        context: {
          detectedQuestionNumber: entry.detectedQuestionNumber,
          mappedQuestionNumber: entry.mappedQuestionNumber,
          mappingConfidence: entry.mappingConfidence,
          readingConfidence: entry.readingConfidence,
          sourcePages: entry.sourcePages,
          warnings: entry.warnings,
        },
      });
    }
  }

  // Mathematics takes a different route from here: its answers are working to
  // be checked step by step against the rubric and marked up on the page the
  // student wrote, which the checkpoint-based pipeline below has no notion of.
  // Everything above — mapping, review signals, response creation — is shared,
  // and every other subject continues exactly as before.
  if (isMathematicsSubject(assessmentSubject)) {
    await runMathCorrectionForSubmission(submissionId);
    await recalculateSubmissionStatus(prisma, submissionId).catch(() => {});
    return;
  }

  // One failed question's evaluation must never prevent or roll back
  // another's successful result — identical reasoning to submitAssessment's
  // own use of Promise.allSettled (not Promise.all) for the typed-answer
  // flow. runPipelineForQuestionResponse's own idempotency guard (claiming
  // via an atomic status transition, skipping already-terminal responses)
  // is reused as-is — nothing here duplicates or competes with it.
  const outcomes = await Promise.allSettled(
    questionResponseIds.map((id) => runPipelineForQuestionResponse(id)),
  );
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error("Unexpected handwritten evaluation failure", outcome.reason);
    }
  }

  // Re-derives Submission.status from the QuestionResponse rows that now
  // exist — the exact same shared utility the typed-answer flow and the
  // teacher review-resolution flow both already use, so a handwritten
  // submission's aggregate status can never disagree with how any other
  // submission type's status is computed.
  await recalculateSubmissionStatus(prisma, submissionId).catch(() => {});
}

/**
 * The ONLY new studentAnswer shape this phase introduces — additive JSON,
 * no schema change. `text` is the sole field the existing, unmodified
 * Answer Reading stage (src/lib/answerReading/index.ts) actually reads;
 * every other field is handwritten-specific provenance that stage silently
 * ignores today but which stays available for this phase's own review
 * signals and any future annotation phase.
 */
function buildHandwrittenStudentAnswer(entry: AnswerIndexEntry & { questionId: string }): object {
  return {
    text: entry.text,
    source: "HANDWRITTEN",
    sourcePages: entry.sourcePages,
    detectedQuestionNumber: entry.detectedQuestionNumber,
    readingConfidence: entry.readingConfidence,
    mappingConfidence: entry.mappingConfidence,
    uncertain: entry.uncertain,
  };
}
