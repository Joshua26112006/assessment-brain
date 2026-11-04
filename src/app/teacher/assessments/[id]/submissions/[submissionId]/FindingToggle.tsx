"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import { submitFindingDecision, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * One AI-suggested finding with a keep / remove button. A finding is only a
 * suggestion: it is drawn on the student's marked copy only while it is kept.
 */
export default function FindingToggle({
  submissionId,
  responseId,
  findingId,
  explanation,
  wrongText,
  kept,
  locked,
}: {
  submissionId: string;
  responseId: string;
  findingId: string;
  explanation: string;
  wrongText: string | null;
  kept: boolean;
  locked: boolean;
}) {
  const action = submitFindingDecision.bind(null, submissionId, responseId, findingId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface-muted p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{explanation}</p>
        {wrongText && (
          <p className="mt-1 text-xs text-subtle">
            Would circle: <span className="font-medium text-muted">{wrongText}</span>
          </p>
        )}
        {state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {state.error}
          </p>
        )}
      </div>
      {locked ? (
        <span className="text-xs text-subtle">{kept ? "Kept" : "Not kept"}</span>
      ) : (
        <form action={formAction}>
          <button
            type="submit"
            name="decision"
            value={kept ? "remove" : "keep"}
            disabled={isPending}
            className={buttonClass(kept ? "ghost" : "secondary", "sm")}
          >
            {isPending ? "Saving…" : kept ? "Kept — remove" : "Keep on student's copy"}
          </button>
        </form>
      )}
    </li>
  );
}
