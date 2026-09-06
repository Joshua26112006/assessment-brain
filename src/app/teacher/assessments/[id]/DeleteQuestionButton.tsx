"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
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
        <button type="submit" disabled={isPending} className={buttonClass("danger", "sm")}>
          {isPending ? "Deleting…" : "Delete"}
        </button>
      </form>
      {state.error && (
        <p className="max-w-52 text-right text-xs font-medium text-danger">{state.error}</p>
      )}
    </div>
  );
}
