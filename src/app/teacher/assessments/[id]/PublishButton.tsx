"use client";

import { useActionState } from "react";
import { publishAssessment, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function PublishButton({
  assessmentId,
  status,
}: {
  assessmentId: string;
  status: string;
}) {
  const action = publishAssessment.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  if (status !== "DRAFT") {
    return null;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isPending ? "Publishing..." : "Publish"}
        </button>
      </form>
      {state.error && (
        <p className="max-w-64 text-right text-xs text-red-600">{state.error}</p>
      )}
    </div>
  );
}
