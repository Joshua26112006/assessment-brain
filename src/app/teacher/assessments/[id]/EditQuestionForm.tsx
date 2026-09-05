"use client";

import { useActionState, useEffect } from "react";
import { updateQuestion, type ActionState } from "./actions";
import type { QuestionCardData } from "./QuestionCard";

const initialState: ActionState = {};

export default function EditQuestionForm({
  question,
  onDone,
}: {
  question: QuestionCardData;
  onDone: () => void;
}) {
  const action = updateQuestion.bind(null, question.id);
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <textarea
        name="questionText"
        defaultValue={question.questionText}
        rows={3}
        className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
      />
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs text-black/60 dark:text-white/60">
            Question number
          </label>
          <input
            name="questionNumber"
            type="number"
            min="1"
            step="1"
            defaultValue={question.questionNumber}
            className="mt-1 w-24 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <div>
          <label className="block text-xs text-black/60 dark:text-white/60">
            Maximum marks
          </label>
          <input
            name="maximumMarks"
            type="number"
            step="0.5"
            min="0.5"
            defaultValue={question.maximumMarks}
            className="mt-1 w-28 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
