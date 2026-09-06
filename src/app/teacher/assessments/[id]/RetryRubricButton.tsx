"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import { retryRubricGeneration, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function RetryRubricButton({ questionId }: { questionId: string }) {
  const action = retryRubricGeneration.bind(null, questionId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-2 flex items-center gap-2">
      <button type="submit" disabled={isPending} className={buttonClass("secondary", "sm")}>
        {isPending ? "Retrying…" : "Retry rubric generation"}
      </button>
      {state.error && <span className="text-xs font-medium text-danger">{state.error}</span>}
    </form>
  );
}
