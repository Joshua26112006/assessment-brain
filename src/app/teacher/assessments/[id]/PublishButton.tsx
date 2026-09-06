"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import { publishAssessment, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * Phase 4.2: the button itself reflects readiness, not just whether the
 * assessment is still a DRAFT. `isReady`/`notReadyMessage` come from the
 * same computeAssessmentReadiness/describeAssessmentReadiness the readiness
 * panel uses (src/lib/assessment/readiness.ts) — see AssessmentReadinessPanel,
 * this button's one call site — so the button's disabled explanation can
 * never say something different from the panel above it.
 *
 * This is a UX convenience only, never the actual guard: publishAssessment
 * independently re-checks readiness against fresh database state before
 * doing anything, so a stale `isReady=true` prop (an old tab, a rubric that
 * failed after this page rendered) can never publish an assessment that
 * isn't really ready — it would just get a rejection from the server action.
 */
export default function PublishButton({
  assessmentId,
  status,
  isReady,
  notReadyMessage,
}: {
  assessmentId: string;
  status: string;
  isReady: boolean;
  notReadyMessage?: string;
}) {
  const action = publishAssessment.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (status !== "DRAFT") {
    return null;
  }

  if (!isReady) {
    return (
      <div className="flex flex-col gap-1.5">
        <button type="button" disabled className={buttonClass("primary")}>
          Publish Assessment
        </button>
        <p className="max-w-72 text-xs text-muted">
          {notReadyMessage || "Complete Assessment Brain analysis first."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form action={formAction}>
        <button type="submit" disabled={isPending} className={buttonClass("primary")}>
          {isPending ? "Publishing…" : "Publish Assessment"}
        </button>
      </form>
      {state.error && <p className="max-w-72 text-xs font-medium text-danger">{state.error}</p>}
    </div>
  );
}
