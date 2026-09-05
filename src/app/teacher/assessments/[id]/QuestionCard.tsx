"use client";

import { useState } from "react";
import EditQuestionForm from "./EditQuestionForm";
import DeleteQuestionButton from "./DeleteQuestionButton";
import RubricEditor from "./RubricEditor";

export type QuestionCardData = {
  id: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  rubric: {
    id: string;
    activeVersion: {
      id: string;
      versionNumber: number;
      solutionApproaches: unknown[];
      markingCheckpoints: unknown[];
    } | null;
    versionCount: number;
  } | null;
};

export default function QuestionCard({ question }: { question: QuestionCardData }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isRubricOpen, setIsRubricOpen] = useState(false);

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <span className="text-xs font-medium text-black/50 dark:text-white/50">
            Question {question.questionNumber} &middot; {question.maximumMarks} marks
          </span>

          {isEditing ? (
            <EditQuestionForm
              question={question}
              onDone={() => setIsEditing(false)}
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm">{question.questionText}</p>
          )}
        </div>

        {!isEditing && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Edit
            </button>
            <DeleteQuestionButton questionId={question.id} />
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/15">
        <button
          type="button"
          onClick={() => setIsRubricOpen((open) => !open)}
          className="text-xs font-medium text-black/70 hover:underline dark:text-white/70"
        >
          {question.rubric?.activeVersion
            ? `Rubric: version ${question.rubric.activeVersion.versionNumber} active (${question.rubric.versionCount} total) ${isRubricOpen ? "▲" : "▼"}`
            : `No rubric yet ${isRubricOpen ? "▲" : "▼"}`}
        </button>

        {isRubricOpen && (
          <RubricEditor
            questionId={question.id}
            activeVersion={question.rubric?.activeVersion ?? null}
          />
        )}
      </div>
    </div>
  );
}
