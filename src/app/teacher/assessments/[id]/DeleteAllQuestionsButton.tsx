"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import { deleteAllQuestions, type ActionState } from "./actions";

const initialState: ActionState = {};

export default function DeleteAllQuestionsButton({
  assessmentId,
  count,
}: {
  assessmentId: string;
  count: number;
}) {
  const action = deleteAllQuestions.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !confirm(
              `Delete all ${count} question${count === 1 ? "" : "s"} on this assessment? This also removes their rubrics and cannot be undone.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button type="submit" disabled={isPending} className={buttonClass("danger", "sm")}>
          {isPending ? "Deleting…" : "Delete all questions"}
        </button>
      </form>
      {state.error && (
        <p className="max-w-72 text-right text-xs font-medium text-danger">{state.error}</p>
      )}
    </div>
  );
}
