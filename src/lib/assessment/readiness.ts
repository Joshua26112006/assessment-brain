import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Phase 4.2 — the single source of truth for "is this assessment allowed to
 * publish?" Both the assessment detail page (informational) and
 * publishAssessment (authoritative, security-relevant) must agree on this
 * exact question, so the calculation lives in exactly one place:
 * computeAssessmentReadiness. Splitting the pure calculation from the DB
 * fetch (getAssessmentReadiness) mirrors the existing
 * submissionStatusSync.ts / submissionStatus.ts precedent — a pure function
 * over already-typed input, plus a thin wrapper that fetches fresh state.
 *
 * A question's rubric falls into exactly one bucket:
 *   READY      - generationStatus is READY and an active version exists.
 *                This is what "evaluation-ready" means, whether the active
 *                version was AI-generated (Phase 4.1) or hand-written via
 *                the legacy manual editor (saveRubricVersion also sets
 *                READY on save — see actions.ts) — both are equally usable
 *                by the evaluation pipeline, which only ever reads
 *                activeVersionId, never how the version was produced.
 *   GENERATING - AI generation is currently running.
 *   FAILED     - the last generation attempt failed; a prior successful
 *                version (if any) is preserved but the row is not counted
 *                READY, since the architecture never lets a rubric return to
 *                GENERATING/FAILED once it has reached READY (see
 *                generateRubricForQuestion's PENDING/FAILED -> GENERATING
 *                claim), so FAILED here always means "never successfully
 *                produced a usable version."
 *   PENDING    - a Rubric row exists but generation hasn't run yet (queued,
 *                or its background task never got a chance to fire).
 *   MISSING    - no Rubric row exists at all for this Question — only
 *                possible for a Question created before Phase 4.1 (every
 *                current creation path creates a companion Rubric row
 *                eagerly). Never counted as ready: there is no evaluation
 *                data to fall back on.
 */
export type RubricReadinessBucket = "READY" | "GENERATING" | "PENDING" | "FAILED" | "MISSING";

export interface QuestionReadiness {
  questionId: string;
  questionNumber: number;
  maximumMarks: number;
  bucket: RubricReadinessBucket;
  generationError: string | null;
}

export interface AssessmentReadiness {
  totalQuestions: number;
  totalMarks: number;
  readyCount: number;
  generatingCount: number;
  pendingCount: number;
  failedCount: number;
  missingCount: number;
  /** True only when there's at least one question and every single one is READY. */
  isReady: boolean;
  questions: QuestionReadiness[];
}

/** The minimal shape computeAssessmentReadiness needs from a Question + its Rubric. */
export interface QuestionForReadiness {
  id: string;
  questionNumber: number;
  maximumMarks: number | Prisma.Decimal;
  rubric: {
    generationStatus: string;
    activeVersionId: string | null;
    generationError: string | null;
  } | null;
}

function bucketFor(rubric: QuestionForReadiness["rubric"]): RubricReadinessBucket {
  if (!rubric) return "MISSING";
  if (rubric.generationStatus === "READY" && rubric.activeVersionId) return "READY";
  if (rubric.generationStatus === "GENERATING") return "GENERATING";
  if (rubric.generationStatus === "FAILED") return "FAILED";
  // Covers the honest PENDING case, and defensively covers the
  // never-expected-in-practice READY-without-activeVersionId inconsistency
  // (generateRubricForQuestion and saveRubricVersion always set both
  // together) — treated as "not usable yet" rather than crashing or
  // silently counting as ready.
  return "PENDING";
}

/**
 * Pure calculation — no I/O. Takes whatever shape of already-fetched
 * questions the caller has (the assessment detail page already has this
 * from getOwnedAssessmentOrNotFound) so it never needs its own round trip.
 */
export function computeAssessmentReadiness(questionsInput: QuestionForReadiness[]): AssessmentReadiness {
  const questions: QuestionReadiness[] = questionsInput.map((q) => ({
    questionId: q.id,
    questionNumber: q.questionNumber,
    maximumMarks: Number(q.maximumMarks),
    bucket: bucketFor(q.rubric),
    generationError: q.rubric?.generationError ?? null,
  }));

  const totalQuestions = questions.length;
  const totalMarks = questions.reduce((sum, q) => sum + q.maximumMarks, 0);
  const readyCount = questions.filter((q) => q.bucket === "READY").length;
  const generatingCount = questions.filter((q) => q.bucket === "GENERATING").length;
  const pendingCount = questions.filter((q) => q.bucket === "PENDING").length;
  const failedCount = questions.filter((q) => q.bucket === "FAILED").length;
  const missingCount = questions.filter((q) => q.bucket === "MISSING").length;

  return {
    totalQuestions,
    totalMarks,
    readyCount,
    generatingCount,
    pendingCount,
    failedCount,
    missingCount,
    isReady: totalQuestions > 0 && readyCount === totalQuestions,
    questions,
  };
}

/**
 * Fetches the CURRENT, fresh state directly from the database and computes
 * readiness from it. This is the version publishAssessment must use — never
 * a value handed in from a page render or a client's stale props, since a
 * rubric can transition (GENERATING -> READY, or the reverse-in-spirit
 * "teacher retries a FAILED one") between when a page was rendered and when
 * the teacher actually clicks Publish.
 */
export async function getAssessmentReadiness(assessmentId: string): Promise<AssessmentReadiness> {
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    orderBy: { questionNumber: "asc" },
    select: {
      id: true,
      questionNumber: true,
      maximumMarks: true,
      rubric: { select: { generationStatus: true, activeVersionId: true, generationError: true } },
    },
  });

  return computeAssessmentReadiness(questions);
}

export interface ReadinessExplanation {
  headline: string;
  message: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}

/**
 * The one place teacher-facing wording for "why (not) ready" is written —
 * reused by both the readiness panel (informational) and publishAssessment
 * (the error message on a rejected publish attempt), so the two can never
 * drift into contradicting each other. Deliberately plain-language only:
 * a generationError (if any) is available on the per-question detail for a
 * secondary/expandable display, never surfaced here as the primary message.
 */
export function describeAssessmentReadiness(readiness: AssessmentReadiness): ReadinessExplanation {
  if (readiness.totalQuestions === 0) {
    return {
      headline: "No questions yet",
      message: "Add at least one question before publishing.",
      tone: "neutral",
    };
  }

  if (readiness.isReady) {
    return {
      headline: "Ready to publish",
      message: "Every question has a ready evaluation rubric. Publishing makes this assessment visible to the class.",
      tone: "success",
    };
  }

  if (readiness.failedCount > 0) {
    const numbers = readiness.questions
      .filter((q) => q.bucket === "FAILED")
      .map((q) => q.questionNumber)
      .join(", ");
    return {
      headline: "Action required",
      message: `Rubric generation failed for question${readiness.failedCount === 1 ? "" : "s"} ${numbers} — retry it below before publishing.`,
      tone: "danger",
    };
  }

  if (readiness.generatingCount > 0 || readiness.pendingCount > 0) {
    return {
      headline: "Analyzing…",
      message: "Assessment Brain is still generating evaluation rubrics. This usually finishes within a minute — the page will update on its own.",
      tone: "info",
    };
  }

  if (readiness.missingCount > 0) {
    const numbers = readiness.questions
      .filter((q) => q.bucket === "MISSING")
      .map((q) => q.questionNumber)
      .join(", ");
    return {
      headline: "Action required",
      message: `Question${readiness.missingCount === 1 ? "" : "s"} ${numbers} ${readiness.missingCount === 1 ? "doesn't" : "don't"} have an evaluation rubric yet.`,
      tone: "warning",
    };
  }

  // Unreachable given the bucket set is exhaustive and isReady already
  // covers "all READY" — kept only as a safe, non-crashing fallback.
  return {
    headline: "Action required",
    message: "This assessment isn't ready to publish yet.",
    tone: "warning",
  };
}
