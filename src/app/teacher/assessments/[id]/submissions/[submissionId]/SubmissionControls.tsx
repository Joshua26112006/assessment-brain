"use client";

import { useActionState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { submitSubmissionDecision, type ActionState } from "./actions";

type StampedState = ActionState & { reviewKey?: string };
const initialState: StampedState = {};

export type SubmissionStage = "REVIEWING" | "CONFIRMED" | "RELEASED";

/**
 * Whole-submission controls. What is offered follows the stage: while
 * reviewing, accept the sure answers and confirm; once confirmed, release;
 * once released (or confirmed), reopen. The server enforces the same order, so
 * hiding a button here is a convenience, not the protection.
 */
export default function SubmissionControls({
  submissionId,
  stage,
  sureLeft,
  reviewKey,
}: {
  submissionId: string;
  stage: SubmissionStage;
  /** Answers that are sure and not yet accepted. */
  sureLeft: number;
  /** Changes whenever an answer is checked or re-marked: a refusal shown before that is out of date. */
  reviewKey: string;
}) {
  const decide = submitSubmissionDecision.bind(null, submissionId);
  // Remember what the answers looked like when a refusal was shown, so it can be hidden once they change.
  const action = async (previous: StampedState, formData: FormData): Promise<StampedState> => ({ ...(await decide(previous, formData)), reviewKey });
  const [state, formAction, isPending] = useActionState(action, initialState);
  const refusalIsCurrent = state.reviewKey === reviewKey;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {stage === "REVIEWING" && (
          <>
            <button
              type="submit"
              name="decision"
              value="acceptAll"
              disabled={isPending || sureLeft === 0}
              className={buttonClass("secondary", "md")}
            >
              {isPending ? "Working…" : `Accept all sure answers${sureLeft > 0 ? ` (${sureLeft})` : ""}`}
            </button>
            <button type="submit" name="decision" value="confirm" disabled={isPending} className={buttonClass("primary", "md")}>
              {isPending ? "Working…" : "Confirm marks"}
            </button>
          </>
        )}

        {stage === "CONFIRMED" && (
          <button type="submit" name="decision" value="release" disabled={isPending} className={buttonClass("primary", "md")}>
            {isPending ? "Working…" : "Release to student"}
          </button>
        )}

        {(stage === "CONFIRMED" || stage === "RELEASED") && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              name="reason"
              maxLength={1000}
              placeholder="Why reopen? (optional)"
              aria-label="Reason for reopening"
              className={`${inputClass} w-56`}
            />
            <button type="submit" name="decision" value="reopen" disabled={isPending} className={buttonClass("ghost", "md")}>
              {isPending ? "Working…" : stage === "RELEASED" ? "Take back & reopen" : "Reopen"}
            </button>
          </div>
        )}
      </div>

      {state.error && refusalIsCurrent && (
        <div role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
          <p className="font-medium">{state.error}</p>
          {state.blockers && state.blockers.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5">
              {state.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.success && (
        <p role="status" className="rounded-lg border border-success-line bg-success-soft px-3 py-2 text-sm font-medium text-success">
          {state.success}
        </p>
      )}
    </form>
  );
}
