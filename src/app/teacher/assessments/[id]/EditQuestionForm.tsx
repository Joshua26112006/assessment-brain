"use client";

import { useActionState, useEffect } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
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

  const numberId = `question-number-${question.id}`;
  const marksId = `question-marks-${question.id}`;
  const textId = `question-text-${question.id}`;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <div>
        <label htmlFor={textId} className="sr-only">
          Question text
        </label>
        <textarea
          id={textId}
          name="questionText"
          defaultValue={question.questionText}
          rows={3}
          className={inputClass}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {/* Width on the wrapper — see AddQuestionForm/RubricEditor for why:
            inputClass's own w-full otherwise competes with a width utility
            on the same element and can win, rendering these full-width. */}
        <div className="w-24">
          <label htmlFor={numberId} className="block text-xs font-medium text-muted">
            Question number
          </label>
          <input
            id={numberId}
            name="questionNumber"
            type="number"
            min="1"
            step="1"
            defaultValue={question.questionNumber}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div className="w-28">
          <label htmlFor={marksId} className="block text-xs font-medium text-muted">
            Maximum marks
          </label>
          <input
            id={marksId}
            name="maximumMarks"
            type="number"
            step="0.5"
            min="0.5"
            defaultValue={question.maximumMarks}
            className={`${inputClass} mt-1`}
          />
        </div>
        <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
          {isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={buttonClass("secondary", "sm")}>
          Cancel
        </button>
      </div>
      {state.error && <p className="text-sm font-medium text-danger">{state.error}</p>}
    </form>
  );
}
