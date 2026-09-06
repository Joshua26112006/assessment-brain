"use client";

import { useActionState, useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { submitReviewDecision, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * The only interactive part of the review page — kept as a small client
 * island so the surrounding evidence stays a server component.
 *
 * Each decision is its own clearly-labelled submit button carrying its own
 * name/value, so a teacher can never be unsure which action they're taking.
 */
export default function ReviewDecisionForm({
  reviewItemId,
  maximumMarks,
  suggestedMarks,
  canConfirm,
  canDismiss,
}: {
  reviewItemId: string;
  maximumMarks: number;
  suggestedMarks: number | null;
  canConfirm: boolean;
  canDismiss: boolean;
}) {
  const action = submitReviewDecision.bind(null, reviewItemId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [overrideMarks, setOverrideMarks] = useState(
    suggestedMarks === null ? "" : String(suggestedMarks),
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {canConfirm && (
        <div>
          <button
            type="submit"
            name="decision"
            value="confirm"
            disabled={isPending}
            className={buttonClass("primary", "md", "w-full")}
          >
            {isPending ? "Saving…" : `Confirm ${suggestedMarks ?? ""} / ${maximumMarks}`}
          </button>
          <p className="mt-1.5 text-xs text-subtle">
            Accept the evaluated mark as final.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface-muted p-4">
        <label htmlFor="overrideMarks" className="block text-sm font-medium">
          Override the mark
        </label>
        <p className="mt-1 text-xs text-muted">
          Replace it with your own, between 0 and {maximumMarks}.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {/* Width lives on the wrapper, not the input's className, so it
              can't lose a cascade tie against inputClass's own w-full. */}
          <div className="w-24 shrink-0">
            <input
              id="overrideMarks"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              max={maximumMarks}
              name="overrideMarks"
              value={overrideMarks}
              onChange={(e) => setOverrideMarks(e.target.value)}
              className={inputClass}
            />
          </div>
          <span className="text-sm text-muted">/ {maximumMarks}</span>
        </div>
        <button
          type="submit"
          name="decision"
          value="override"
          disabled={isPending}
          className={buttonClass("secondary", "md", "mt-3 w-full")}
        >
          {isPending ? "Saving…" : "Override & resolve"}
        </button>
      </div>

      <div>
        <label htmlFor="feedbackNote" className="block text-sm font-medium">
          Feedback for the student{" "}
          <span className="font-normal text-subtle">(optional)</span>
        </label>
        <textarea
          id="feedbackNote"
          name="feedbackNote"
          rows={3}
          maxLength={2000}
          placeholder="Explain your decision in a sentence or two…"
          className={`${inputClass} mt-1.5`}
        />
        <p className="mt-1 text-xs text-subtle">
          Shown to the student with their result. Saved with whichever action you choose.
        </p>
      </div>

      {canDismiss && (
        <div>
          <button
            type="submit"
            name="decision"
            value="dismiss"
            disabled={isPending}
            className={buttonClass("ghost", "sm", "w-full")}
          >
            {isPending ? "Saving…" : "Dismiss flag (no mark change)"}
          </button>
          <p className="mt-1 text-xs text-subtle">
            Closes this flag and leaves the mark exactly as it is.
          </p>
        </div>
      )}

      {!canConfirm && (
        <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-muted">
          There is no completed evaluation to confirm for this response — enter a mark to resolve
          it.
        </p>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="rounded-lg border border-success-line bg-success-soft px-3 py-2 text-sm font-medium text-success"
        >
          Review resolved.
        </p>
      )}
    </form>
  );
}
