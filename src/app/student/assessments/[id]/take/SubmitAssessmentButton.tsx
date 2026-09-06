"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "@/components/ui/styles";
import { submitAssessment, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * Submitting is irreversible, so it's a deliberate two-step: the student
 * confirms in-page rather than through a browser dialog. The underlying
 * action is unchanged — the real submit button simply lives in the
 * confirmation step.
 */
export default function SubmitAssessmentButton({
  submissionId,
  unansweredCount,
}: {
  submissionId: string;
  unansweredCount: number;
}) {
  const action = submitAssessment.bind(null, submissionId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className={buttonClass("primary")}
        >
          Submit assessment
        </button>
        {state.error && (
          <p className="text-right text-xs font-medium text-danger">{state.error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-warning-line bg-warning-soft p-4 sm:w-80">
      <p className="text-sm font-medium text-warning">Submit for marking?</p>
      <p className="mt-1 text-xs text-warning">
        {unansweredCount > 0
          ? `${unansweredCount} question${unansweredCount === 1 ? " has" : "s have"} no saved answer. `
          : ""}
        You won&apos;t be able to change your answers afterwards.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={formAction}>
          <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
            {isPending ? "Submitting…" : "Yes, submit"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setIsConfirming(false)}
          disabled={isPending}
          className={buttonClass("secondary", "sm")}
        >
          Keep working
        </button>
      </div>
      {state.error && <p className="mt-2 text-xs font-medium text-danger">{state.error}</p>}
    </div>
  );
}
