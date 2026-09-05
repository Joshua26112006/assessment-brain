"use client";

import { useActionState } from "react";
import { saveAnswer, type ActionState } from "./actions";

const initialState: ActionState = {};

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

  return (
    <form
      action={formAction}
      className="rounded-lg border border-black/10 p-4 dark:border-white/15"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-black/50 dark:text-white/50">
          Question {questionNumber} &middot; {maximumMarks} marks
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{questionText}</p>

      <textarea
        name="answerText"
        defaultValue={initialAnswer}
        rows={4}
        placeholder="Type your answer here..."
        className="mt-3 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {isPending ? "Saving..." : "Save answer"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>
        )}
      </div>
    </form>
  );
}
