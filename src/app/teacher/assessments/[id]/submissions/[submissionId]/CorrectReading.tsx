"use client";

import { useState, useActionState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { correctReadingAction, type ActionState } from "./actions";

const initial: ActionState = {};

/**
 * Lets the teacher fix what was read from the handwriting and have the answer marked again from their text.
 * Shown only while the marks are not confirmed and the teacher has not decided this answer.
 */
export default function CorrectReading({
  submissionId,
  responseId,
  currentText,
  locked,
  decided,
}: {
  submissionId: string;
  responseId: string;
  currentText: string;
  locked: boolean;
  decided: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(correctReadingAction.bind(null, submissionId, responseId), initial);

  if (locked) return null;
  if (decided) {
    return <p className="text-xs text-muted">You have already decided this answer, so the reading cannot be corrected. Reopen your decision to change it.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
            The reading is wrong: fix it
          </button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <label className="text-xs font-medium text-muted" htmlFor={`reading-${responseId}`}>
            Type exactly what the student wrote, mistakes included. Do not correct their working.
          </label>
          <textarea id={`reading-${responseId}`} name="text" defaultValue={currentText} rows={5} maxLength={4000} className={inputClass} />
          <p className="text-xs text-subtle">
            The answer is then marked again from your text and the AI&apos;s earlier draft is replaced (it stays in the history). The page itself is not changed.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
              {pending ? "Marking again…" : "Save and mark again"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {state.success && <p role="status" className="text-xs text-success">{state.success}</p>}
    </div>
  );
}
