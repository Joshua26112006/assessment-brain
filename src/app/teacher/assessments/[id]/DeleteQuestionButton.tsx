"use client";

import { useActionState } from "react";
import { deleteQuestion, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function DeleteQuestionButton({ questionId }: { questionId: string }) {
  const action = deleteQuestion.bind(null, questionId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm("Delete this question? This cannot be undone.")) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          {isPending ? "Deleting..." : "Delete"}
        </button>
      </form>
      {state.error && (
        <p className="max-w-48 text-right text-xs text-red-600">{state.error}</p>
      )}
    </div>
  );
}
