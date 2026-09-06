"use client";

import { useState } from "react";
import StatusBadge from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
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

  const activeVersion = question.rubric?.activeVersion ?? null;
  const checkpointCount = activeVersion?.markingCheckpoints.length ?? 0;
  const approachCount = activeVersion?.solutionApproaches.length ?? 0;

  return (
    <article className="rounded-xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-muted text-xs font-semibold text-muted"
            >
              {question.questionNumber}
            </span>
            <span className="text-xs font-medium text-subtle">
              Question {question.questionNumber} · {question.maximumMarks} marks
            </span>
          </div>

          {isEditing ? (
            <EditQuestionForm question={question} onDone={() => setIsEditing(false)} />
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {question.questionText}
            </p>
          )}
        </div>

        {!isEditing && (
          <div className="flex shrink-0 items-start gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className={buttonClass("secondary", "sm")}
            >
              Edit
            </button>
            <DeleteQuestionButton questionId={question.id} />
          </div>
        )}
      </div>

      <div className="border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setIsRubricOpen((open) => !open)}
          aria-expanded={isRubricOpen}
          className="flex w-full flex-wrap items-center gap-2 text-left text-sm"
        >
          {activeVersion ? (
            <>
              <StatusBadge label={`Rubric v${activeVersion.versionNumber}`} tone="success" size="sm" />
              <span className="text-xs text-muted">
                {approachCount} approach{approachCount === 1 ? "" : "es"} · {checkpointCount}{" "}
                checkpoint{checkpointCount === 1 ? "" : "s"}
                {question.rubric && question.rubric.versionCount > 1
                  ? ` · ${question.rubric.versionCount} versions`
                  : ""}
              </span>
            </>
          ) : (
            <StatusBadge label="No rubric yet" tone="warning" size="sm" />
          )}
          <span className="ml-auto text-xs font-medium text-accent-text">
            {isRubricOpen ? "Hide rubric" : activeVersion ? "Edit rubric" : "Add rubric"}
          </span>
        </button>

        {isRubricOpen && <RubricEditor questionId={question.id} activeVersion={activeVersion} />}
      </div>
    </article>
  );
}
