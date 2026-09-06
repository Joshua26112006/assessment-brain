"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { saveAnswer, type ActionState } from "./actions";

const initialState: ActionState = {};

/**
 * One question and its answer box.
 *
 * The save indicator is deliberately honest: it compares what's in the box
 * against what was last successfully written to the server, so "Saved" only
 * ever appears when the current text really is the stored text. There is no
 * autosave — the student presses Save — and the UI never implies otherwise.
 */
export default function AnswerForm({
  submissionId,
  questionId,
  questionNumber,
  questionText,
  maximumMarks,
  initialAnswer,
}: {
  submissionId: string;
  questionId: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  initialAnswer: string;
}) {
  const action = saveAnswer.bind(null, submissionId, questionId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const [value, setValue] = useState(initialAnswer);
  const [savedValue, setSavedValue] = useState(initialAnswer);
  // What was in the box at the moment of submission — the text the server
  // actually received, which may differ from `value` if typing continued.
  const submittedValueRef = useRef(initialAnswer);

  useEffect(() => {
    if (state.success) {
      setSavedValue(submittedValueRef.current);
    }
  }, [state]);

  const hasUnsavedChanges = value !== savedValue;
  const hasSavedAnswer = savedValue.trim().length > 0;

  const status = isPending
    ? { label: "Saving…", tone: "text-muted" }
    : hasUnsavedChanges
      ? { label: "Unsaved changes", tone: "text-warning" }
      : hasSavedAnswer
        ? { label: "Saved", tone: "text-success" }
        : { label: "Not answered yet", tone: "text-subtle" };

  const fieldId = `answer-${questionId}`;

  return (
    <form
      action={(formData) => {
        submittedValueRef.current = value;
        formAction(formData);
      }}
      className="rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-6 w-6 place-items-center rounded-md bg-surface-muted text-xs font-semibold text-muted"
          >
            {questionNumber}
          </span>
          <span className="text-xs font-medium text-subtle">
            Question {questionNumber} · {maximumMarks} marks
          </span>
        </div>
        <span className={`text-xs font-medium ${status.tone}`}>{status.label}</span>
      </div>

      <label htmlFor={fieldId} className="mt-2 block whitespace-pre-wrap text-sm leading-relaxed">
        {questionText}
      </label>

      <textarea
        id={fieldId}
        name="answerText"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        placeholder="Type your answer here…"
        className={`${inputClass} mt-3 leading-relaxed`}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !hasUnsavedChanges}
          className={buttonClass("secondary", "sm")}
        >
          {isPending ? "Saving…" : hasUnsavedChanges ? "Save answer" : "Saved"}
        </button>
        {state.error && <p className="text-sm font-medium text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
