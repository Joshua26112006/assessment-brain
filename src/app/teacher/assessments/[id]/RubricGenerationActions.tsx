"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import StatusBadge from "@/components/ui/StatusBadge";
import { generateAllRubrics, type ActionState } from "./actions";
import type { AssessmentReadiness } from "@/lib/assessment/readiness";

const initialState: ActionState = {};

/**
 * Phase 4.3 Step 11 (extended in Phase 4.4) — the one assessment-level
 * rubric-generation call to action, its label and behavior entirely driven
 * by the shared `readiness` object (never a separate calculation):
 *
 *   - isReady                        -> "View Complete Assessment Rubric"
 *   - generatingCount > 0            -> inert "Generating…" status (no
 *                                        button — a second click would just
 *                                        no-op against the atomic claim
 *                                        anyway; showing it as inert is
 *                                        clearer than a button that does
 *                                        nothing)
 *   - failedCount > 0                -> "Retry Failed Rubrics" + a secondary
 *                                        "View rubrics" link, so a teacher
 *                                        can see what's already done
 *   - pendingCount/missingCount > 0  -> "Generate All Rubrics" (the primary
 *                                        entry point into the whole feature)
 *   - otherwise, only reviewRequiredCount > 0 remains -> no button at all:
 *                                        generateAllRubrics never touches a
 *                                        REVIEW_REQUIRED question (Phase
 *                                        4.4 — it can only leave that state
 *                                        via an edit, see actions.ts), so a
 *                                        bulk-generate button here would be
 *                                        a dead click. Points at the
 *                                        flagged question(s) instead.
 *
 * "Retry Failed Rubrics" and "Generate All Rubrics" both call the exact same
 * server action (generateAllRubrics) — it already only targets questions
 * that are PENDING, FAILED, or missing a Rubric row, so a click after a
 * partial failure naturally retries only the failed ones. Only the button's
 * label changes.
 */
export default function RubricGenerationActions({
  assessmentId,
  readiness,
}: {
  assessmentId: string;
  readiness: AssessmentReadiness;
}) {
  const action = generateAllRubrics.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (readiness.totalQuestions === 0) {
    return null;
  }

  if (readiness.isReady) {
    return (
      <Link href={`/teacher/assessments/${assessmentId}/rubrics`} className={buttonClass("secondary")}>
        View Complete Assessment Rubric
      </Link>
    );
  }

  if (readiness.generatingCount > 0) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <StatusBadge label="Generating…" tone="info" />
        <p className="max-w-72 text-right text-xs text-muted">
          Assessment Brain is generating rubrics. This page updates on its own.
        </p>
      </div>
    );
  }

  if (readiness.failedCount > 0) {
    return (
      <div className="flex flex-col items-end gap-2">
        <form action={formAction}>
          <button type="submit" disabled={isPending} className={buttonClass("primary")}>
            {isPending ? "Retrying…" : "Retry Failed Rubrics"}
          </button>
        </form>
        <Link
          href={`/teacher/assessments/${assessmentId}/rubrics`}
          className="text-xs font-medium text-accent-text hover:underline"
        >
          View rubrics
        </Link>
        {state.error && <p className="max-w-72 text-right text-xs font-medium text-danger">{state.error}</p>}
      </div>
    );
  }

  if (readiness.pendingCount > 0 || readiness.missingCount > 0) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <form action={formAction}>
          <button type="submit" disabled={isPending} className={buttonClass("primary")}>
            {isPending ? "Starting…" : "✨ Generate All Rubrics"}
          </button>
        </form>
        {state.error && <p className="max-w-72 text-right text-xs font-medium text-danger">{state.error}</p>}
      </div>
    );
  }

  // Only remaining possibility: reviewRequiredCount > 0 and nothing else is
  // outstanding — there's nothing left for a bulk action to generate.
  return (
    <div className="flex flex-col items-end gap-1.5">
      <StatusBadge
        label={`${readiness.reviewRequiredCount} question${readiness.reviewRequiredCount === 1 ? "" : "s"} need${
          readiness.reviewRequiredCount === 1 ? "s" : ""
        } review`}
        tone="danger"
      />
      <p className="max-w-72 text-right text-xs text-muted">
        Edit the flagged question{readiness.reviewRequiredCount === 1 ? "" : "s"} below, then generate its rubric.
      </p>
    </div>
  );
}
