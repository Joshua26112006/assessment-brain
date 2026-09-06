"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
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
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <button type="submit" disabled={isPending} className={buttonClass("primary")}>
          {isPending ? "Publishing…" : "Publish to class"}
        </button>
      </form>
      {state.error && (
        <p className="max-w-72 text-right text-xs font-medium text-danger">{state.error}</p>
      )}
    </div>
  );
}
