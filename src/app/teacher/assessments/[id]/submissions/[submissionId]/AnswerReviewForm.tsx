"use client";

import { useActionState, useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { submitAnswerDecision, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * The teacher's controls for one answer: accept the drafted mark, replace it,
 * or write a comment. Each is its own labelled submit button carrying its own
 * value, so it is never unclear which action is being taken.
 *
 * Rendered read-only (`locked`) once the submission is confirmed — the server
 * refuses changes then anyway; this just avoids offering them.
 */
export default function AnswerReviewForm({
  submissionId,
  responseId,
  maximumMarks,
  draftMarks,
  reviewed,
  locked,
  existingNote,
}: {
  submissionId: string;
  responseId: string;
  maximumMarks: number;
  /** The mark currently stored, or null when there is none to accept. */
  draftMarks: number | null;
  reviewed: boolean;
  locked: boolean;
  existingNote: string;
}) {
  const action = submitAnswerDecision.bind(null, submissionId, responseId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [marks, setMarks] = useState(draftMarks === null ? "" : String(draftMarks));

  if (locked) {
    return (
      <p className="text-xs text-subtle">
        Confirmed. Reopen the submission to change this answer.
        {existingNote && <span className="mt-1 block text-muted">Comment: {existingNote}</span>}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {draftMarks !== null && !reviewed && (
          <button
            type="submit"
            name="decision"
            value="accept"
            disabled={isPending}
            className={buttonClass("primary", "md")}
          >
            {isPending ? "Saving…" : `Accept ${draftMarks} / ${maximumMarks}`}
          </button>
        )}

        <div>
          <label htmlFor={`marks-${responseId}`} className="block text-xs font-medium text-muted">
            {draftMarks === null ? "Enter a mark" : "Change the mark"}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <div className="w-24 shrink-0">
              <input
                id={`marks-${responseId}`}
                type="number"
                inputMode="decimal"
                step="0.5"
                min={0}
                max={maximumMarks}
                name="marks"
                value={marks}
                onChange={(event) => setMarks(event.target.value)}
                className={inputClass}
              />
            </div>
            <span className="text-sm text-muted">/ {maximumMarks}</span>
            <button
              type="submit"
              name="decision"
              value="change"
              disabled={isPending}
              className={buttonClass("secondary", "md")}
            >
              {isPending ? "Saving…" : "Save mark"}
            </button>
          </div>
        </div>
      </div>

      <div>
        <label htmlFor={`reason-${responseId}`} className="block text-xs font-medium text-muted">
          Reason for changing the mark <span className="font-normal text-subtle">(required when you change the mark; kept in the history)</span>
        </label>
        <input
          id={`reason-${responseId}`}
          name="reason"
          maxLength={1000}
          className={`${inputClass} mt-1`}
          placeholder="e.g. method correct, unit missing"
        />
      </div>

      <div>
        <label htmlFor={`note-${responseId}`} className="block text-xs font-medium text-muted">
          Comment for the student <span className="font-normal text-subtle">(shown when you release)</span>
        </label>
        <p className="mt-0.5 text-xs text-subtle">
          If you change the mark, the AI&apos;s feedback is not shown to the student: write your own comment here instead.
        </p>
        <textarea
          id={`note-${responseId}`}
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={existingNote}
          className={`${inputClass} mt-1`}
        />
        <button
          type="submit"
          name="decision"
          value="comment"
          disabled={isPending}
          className={buttonClass("ghost", "sm", "mt-2")}
        >
          {isPending ? "Saving…" : "Save comment only"}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="rounded-lg border border-success-line bg-success-soft px-3 py-2 text-sm font-medium text-success">
          {state.success}
        </p>
      )}
    </form>
  );
}
