"use client";

import { useActionState, useRef, useEffect } from "react";
import { buttonClass, inputClass, labelClass } from "@/components/ui/styles";
import { createQuestion, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function AddQuestionForm({ assessmentId }: { assessmentId: string }) {
  const action = createQuestion.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-line-strong bg-surface-muted p-5"
    >
      <div>
        <label htmlFor="questionText" className={labelClass}>
          Add a question
        </label>
        <textarea
          id="questionText"
          name="questionText"
          placeholder="e.g. Explain how photosynthesis converts light energy into chemical energy."
          rows={3}
          className={`${inputClass} mt-1.5`}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* w-28 on the wrapper: inputClass already carries w-full, and pairing
            it with a width utility on the same element left the result up to
            Tailwind's utility ordering rather than this className — it
            rendered full-width instead of narrow. */}
        <div className="w-28">
          <label htmlFor="maximumMarks" className="block text-xs font-medium text-muted">
            Maximum marks
          </label>
          <input
            id="maximumMarks"
            name="maximumMarks"
            type="number"
            step="0.5"
            min="0.5"
            className={`${inputClass} mt-1`}
          />
        </div>
        <button type="submit" disabled={isPending} className={buttonClass("primary")}>
          {isPending ? "Adding…" : "Add question"}
        </button>
      </div>

      {state.error && <p className="text-sm font-medium text-danger">{state.error}</p>}
    </form>
  );
}
