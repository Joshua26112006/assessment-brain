"use client";

import { useActionState, useRef, useEffect } from "react";
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
      className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15"
    >
      <h3 className="text-sm font-medium">Add a question</h3>
      <textarea
        name="questionText"
        placeholder="Question text"
        rows={3}
        className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
      />
      <div className="flex items-end gap-3">
        <div>
          <label htmlFor="maximumMarks" className="block text-xs text-black/60 dark:text-white/60">
            Maximum marks
          </label>
          <input
            id="maximumMarks"
            name="maximumMarks"
            type="number"
            step="0.5"
            min="0.5"
            className="mt-1 w-28 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isPending ? "Adding..." : "Add question"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
