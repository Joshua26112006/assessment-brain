"use client";

import { useState } from "react";
import StatusBadge, { rubricGenerationBadge } from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import EditQuestionForm from "./EditQuestionForm";
import DeleteQuestionButton from "./DeleteQuestionButton";
import RubricEditor from "./RubricEditor";
import RubricViewer, { type RubricViewerApproach, type RubricViewerCheckpoint } from "./RubricViewer";
import RetryRubricButton from "./RetryRubricButton";

export type QuestionCardData = {
  id: string;
  questionNumber: number;
  questionText: string;
  maximumMarks: number;
  rubric: {
    id: string;
    generationStatus: "PENDING" | "GENERATING" | "READY" | "FAILED";
    generationError: string | null;
    activeVersion: {
      id: string;
      versionNumber: number;
      expectedAnswer: string | null;
      partialCreditGuidance: string | null;
      solutionApproaches: RubricViewerApproach[];
      markingCheckpoints: RubricViewerCheckpoint[];
    } | null;
    versionCount: number;
  } | null;
};

/**
 * Phase 4.1 — legacy shape RubricEditor still expects for its manual
 * fallback path (see EditorApproach/EditorCheckpoint there): only label/
 * description and description/marks, since a teacher editing manually never
 * writes steps or isPrimary.
 */
function toEditorApproaches(approaches: RubricViewerApproach[]): { label: string; description: string }[] {
  return approaches.map((a) => ({ label: a.label, description: a.description }));
}
function toEditorCheckpoints(checkpoints: RubricViewerCheckpoint[]): { description: string; marks: number }[] {
  return checkpoints.map((c) => ({ description: c.description, marks: c.marks }));
}

export default function QuestionCard({ question }: { question: QuestionCardData }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isRubricOpen, setIsRubricOpen] = useState(false);
  const [isManualEditOpen, setIsManualEditOpen] = useState(false);

  const rubric = question.rubric;
  const activeVersion = rubric?.activeVersion ?? null;
  const generationStatus = rubric?.generationStatus ?? "PENDING";
  const readyBadge = rubricGenerationBadge(generationStatus);

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
        {generationStatus === "READY" && activeVersion ? (
          <>
            <button
              type="button"
              onClick={() => setIsRubricOpen((open) => !open)}
              aria-expanded={isRubricOpen}
              className="flex w-full flex-wrap items-center gap-2 text-left text-sm"
            >
              <StatusBadge label={readyBadge.label} tone={readyBadge.tone} size="sm" />
              <span className="text-xs text-muted">
                {activeVersion.solutionApproaches.length} approach
                {activeVersion.solutionApproaches.length === 1 ? "" : "es"} ·{" "}
                {activeVersion.markingCheckpoints.length} checkpoint
                {activeVersion.markingCheckpoints.length === 1 ? "" : "s"}
                {rubric && rubric.versionCount > 1 ? ` · ${rubric.versionCount} versions` : ""}
              </span>
              <span className="ml-auto text-xs font-medium text-accent-text">
                {isRubricOpen ? "Hide rubric" : "View rubric"}
              </span>
            </button>

            {isRubricOpen && (
              <>
                <RubricViewer
                  rubric={{
                    versionNumber: activeVersion.versionNumber,
                    expectedAnswer: activeVersion.expectedAnswer,
                    solutionApproaches: activeVersion.solutionApproaches,
                    markingCheckpoints: activeVersion.markingCheckpoints,
                    partialCreditGuidance: activeVersion.partialCreditGuidance,
                  }}
                />

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setIsManualEditOpen((open) => !open)}
                    className="text-xs font-medium text-subtle hover:text-foreground hover:underline"
                  >
                    {isManualEditOpen ? "Hide manual override" : "Advanced: edit rubric manually"}
                  </button>
                  {isManualEditOpen && (
                    <RubricEditor
                      questionId={question.id}
                      activeVersion={{
                        versionNumber: activeVersion.versionNumber,
                        solutionApproaches: toEditorApproaches(activeVersion.solutionApproaches),
                        markingCheckpoints: toEditorCheckpoints(activeVersion.markingCheckpoints),
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </>
        ) : generationStatus === "FAILED" ? (
          <div>
            <StatusBadge label="Rubric generation failed" tone="danger" size="sm" />
            <p className="mt-1.5 text-xs text-muted">
              {rubric?.generationError || "Something went wrong while generating this rubric."}
            </p>
            <RetryRubricButton questionId={question.id} />
          </div>
        ) : rubric === null ? (
          <div>
            <StatusBadge label="No rubric yet" tone="warning" size="sm" />
            <p className="mt-1.5 text-xs text-muted">
              This question doesn&apos;t have a rubric generation record yet.
            </p>
            <RetryRubricButton questionId={question.id} />
          </div>
        ) : generationStatus === "GENERATING" ? (
          <div className="flex items-center gap-2">
            <StatusBadge label={readyBadge.label} tone={readyBadge.tone} size="sm" />
            <p className="text-xs text-muted">
              Assessment Brain is writing a marking rubric for this question.
            </p>
          </div>
        ) : (
          // PENDING — the normal, potentially long-lived state before the
          // teacher clicks "Generate All Rubrics" above (Phase 4.3:
          // generation is no longer triggered automatically).
          <div className="flex items-center gap-2">
            <StatusBadge label={readyBadge.label} tone={readyBadge.tone} size="sm" />
            <p className="text-xs text-muted">
              Not generated yet — use &quot;Generate All Rubrics&quot; above to create rubrics for every question at once.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
