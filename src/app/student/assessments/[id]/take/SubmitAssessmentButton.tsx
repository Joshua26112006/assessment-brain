"use client";

import { useActionState } from "react";
import { submitAssessment, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function SubmitAssessmentButton({ submissionId }: { submissionId: string }) {
  const action = submitAssessment.bind(null, submissionId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!confirm("Submit your answers? You won't be able to edit them afterward.")) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isPending ? "Submitting..." : "Submit Assessment"}
        </button>
      </form>
      {state.error && <p className="max-w-64 text-right text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
