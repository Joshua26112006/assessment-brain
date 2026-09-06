"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Page";
import { buttonClass, inputClass, labelClass } from "@/components/ui/styles";
import StatusBadge from "@/components/ui/StatusBadge";
import type { ExtractedPaperDraft, ExtractedQuestionDraft } from "@/types/questionPaper";
import {
  approveExtraction,
  retryExtraction,
  type QuestionPaperActionState,
} from "./questionPaperActions";

export interface QuestionPaperReviewData {
  id: string;
  extractionStatus: "PENDING" | "PROCESSING" | "EXTRACTED" | "FAILED" | "APPROVED";
  extractionError: string | null;
  extractedContent: ExtractedPaperDraft | null;
  pages: {
    id: string;
    pageNumber: number;
    originalFilename: string;
    mimeType: string;
  }[];
}

const initialState: QuestionPaperActionState = {};

/** Polls the server (via a soft refresh) while extraction is still running, so the teacher never has to manually reload to see it finish. */
function useAutoRefreshWhileProcessing(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(interval);
  }, [active, router]);
}

export default function QuestionPaperReview({
  assessmentId,
  questionPaper,
}: {
  assessmentId: string;
  questionPaper: QuestionPaperReviewData;
}) {
  useAutoRefreshWhileProcessing(
    questionPaper.extractionStatus === "PENDING" || questionPaper.extractionStatus === "PROCESSING",
  );

  return (
    <Card className="mb-6" padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Question paper</h2>
        <StatusPill status={questionPaper.extractionStatus} />
      </div>

      <div className="p-5">
        <OriginalPagesList assessmentId={assessmentId} pages={questionPaper.pages} />

        {(questionPaper.extractionStatus === "PENDING" ||
          questionPaper.extractionStatus === "PROCESSING") && (
          <p role="status" aria-live="polite" className="mt-4 text-sm text-muted">
            Reading your question paper and extracting the questions… this usually takes under a
            minute.
          </p>
        )}

        {questionPaper.extractionStatus === "FAILED" && (
          <FailedState
            assessmentId={assessmentId}
            error={questionPaper.extractionError}
          />
        )}

        {questionPaper.extractionStatus === "EXTRACTED" && questionPaper.extractedContent && (
          <ExtractedDraftEditor
            assessmentId={assessmentId}
            draft={questionPaper.extractedContent}
          />
        )}
      </div>

      <RemoveDraftControl assessmentId={assessmentId} disabled={questionPaper.extractionStatus === "PROCESSING"} />
    </Card>
  );
}

function StatusPill({ status }: { status: QuestionPaperReviewData["extractionStatus"] }) {
  switch (status) {
    case "PENDING":
    case "PROCESSING":
      return <StatusBadge label="Extracting…" tone="info" size="sm" />;
    case "EXTRACTED":
      return <StatusBadge label="Draft ready for review" tone="warning" size="sm" />;
    case "FAILED":
      return <StatusBadge label="Extraction failed" tone="danger" size="sm" />;
    case "APPROVED":
      return <StatusBadge label="Approved" tone="success" size="sm" />;
  }
}

function OriginalPagesList({
  assessmentId,
  pages,
}: {
  assessmentId: string;
  pages: QuestionPaperReviewData["pages"];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Uploaded pages</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {pages.map((page) => (
          <li key={page.id}>
            <a
              href={`/api/teacher/assessments/${assessmentId}/question-paper/pages/${page.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "sm")}
            >
              {page.mimeType === "application/pdf" ? "View PDF" : `View page ${page.pageNumber}`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FailedState({ assessmentId, error }: { assessmentId: string; error: string | null }) {
  const action = retryExtraction.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4">
      <p className="text-sm font-medium text-danger">Extraction failed</p>
      <p className="mt-1 text-sm text-danger">
        {error || "Something went wrong while reading this question paper."}
      </p>
      <form action={formAction} className="mt-3">
        <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
          {isPending ? "Retrying…" : "Retry extraction"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-xs font-medium text-danger">{state.error}</p>}
    </div>
  );
}

function RemoveDraftControl({ assessmentId, disabled }: { assessmentId: string; disabled: boolean }) {
  const router = useRouter();
  const [isRemoving, setIsRemoving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setIsRemoving(true);
    setError(null);
    try {
      const response = await fetch(`/api/teacher/assessments/${assessmentId}/question-paper`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError((body && typeof body.error === "string" && body.error) || "Couldn't remove this question paper.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsRemoving(false);
      setIsConfirming(false);
    }
  }

  return (
    <div className="border-t border-line p-5">
      {!isConfirming ? (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          disabled={disabled}
          className={buttonClass("danger", "sm")}
        >
          Remove and start over
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Remove this question paper and upload a different one?</p>
          <button
            type="button"
            onClick={handleRemove}
            disabled={isRemoving}
            className={buttonClass("danger", "sm")}
          >
            {isRemoving ? "Removing…" : "Yes, remove it"}
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            disabled={isRemoving}
            className={buttonClass("secondary", "sm")}
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

let nextLocalId = 0;
function makeLocalId() {
  nextLocalId += 1;
  return `local-${Date.now()}-${nextLocalId}`;
}

type EditableQuestion = ExtractedQuestionDraft & { localId: string };

function ExtractedDraftEditor({
  assessmentId,
  draft,
}: {
  assessmentId: string;
  draft: ExtractedPaperDraft;
}) {
  const [title, setTitle] = useState(draft.title ?? "");
  const [instructions, setInstructions] = useState(draft.instructions ?? "");
  const [questions, setQuestions] = useState<EditableQuestion[]>(() =>
    draft.questions.map((q) => ({ ...q, localId: makeLocalId() })),
  );
  const [isConfirming, setIsConfirming] = useState(false);

  const action = approveExtraction.bind(null, assessmentId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  function updateQuestion(localId: string, patch: Partial<EditableQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.localId === localId ? { ...q, ...patch } : q)));
  }

  function removeQuestion(localId: string) {
    setQuestions((prev) => prev.filter((q) => q.localId !== localId));
  }

  function addQuestion() {
    const nextNumber = questions.length > 0 ? Math.max(...questions.map((q) => q.number)) + 1 : 1;
    setQuestions((prev) => [
      ...prev,
      { localId: makeLocalId(), number: nextNumber, text: "", marks: null, uncertain: false },
    ]);
  }

  function moveQuestion(localId: string, direction: "up" | "down") {
    setQuestions((prev) => {
      const index = prev.findIndex((q) => q.localId === localId);
      if (index === -1) return prev;
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  const questionsJson = JSON.stringify(
    questions.map((q) => ({ number: q.number, text: q.text, marks: q.marks })),
  );

  return (
    <div className="mt-4">
      <p className="rounded-lg border border-warning-line bg-warning-soft p-3 text-sm font-medium text-warning">
        This is an AI-generated draft. Please review every question before publishing.
      </p>

      {draft.extractionWarnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-line bg-surface-muted p-3 text-xs text-muted">
          {draft.extractionWarnings.map((warning, index) => (
            <li key={index}>• {warning}</li>
          ))}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="questionsJson" value={questionsJson} />

        <div>
          <label htmlFor="paper-title" className={labelClass}>
            Assessment title
          </label>
          <input
            id="paper-title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Leave blank to keep the current title"
            className={`${inputClass} mt-1.5`}
          />
        </div>

        <div>
          <label htmlFor="paper-instructions" className={labelClass}>
            Instructions for students
          </label>
          <textarea
            id="paper-instructions"
            name="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="e.g. Answer all questions. Show your working."
            className={`${inputClass} mt-1.5`}
          />
        </div>

        <div>
          <p className={labelClass}>Questions ({questions.length})</p>
          <ul className="mt-2 flex flex-col gap-3">
            {questions.map((question, index) => (
              <li
                key={question.localId}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {question.uncertain && (
                      <StatusBadge label="Please double-check" tone="warning" size="sm" />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Move question ${index + 1} up`}
                      onClick={() => moveQuestion(question.localId, "up")}
                      disabled={index === 0}
                      className={buttonClass("secondary", "sm")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move question ${index + 1} down`}
                      onClick={() => moveQuestion(question.localId, "down")}
                      disabled={index === questions.length - 1}
                      className={buttonClass("secondary", "sm")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove question ${index + 1}`}
                      onClick={() => removeQuestion(question.localId)}
                      className={buttonClass("danger", "sm")}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="w-24">
                    <label className="block text-xs font-medium text-muted">Number</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={question.number}
                      onChange={(e) =>
                        updateQuestion(question.localId, { number: Number(e.target.value) })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-muted">Marks</label>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={question.marks ?? ""}
                      placeholder="Required"
                      onChange={(e) =>
                        updateQuestion(question.localId, {
                          marks: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-medium text-muted">Question text</label>
                  <textarea
                    value={question.text}
                    onChange={(e) => updateQuestion(question.localId, { text: e.target.value })}
                    rows={3}
                    className={`${inputClass} mt-1`}
                  />
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addQuestion}
            className={`${buttonClass("secondary", "sm")} mt-3`}
          >
            Add a question
          </button>
        </div>

        {state.error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {state.error}
          </p>
        )}

        {!isConfirming ? (
          <div>
            <button
              type="button"
              onClick={() => setIsConfirming(true)}
              disabled={questions.length === 0}
              className={buttonClass("primary")}
            >
              Approve extracted questions
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-warning-line bg-warning-soft p-4">
            <p className="text-sm font-medium text-warning">Approve these questions?</p>
            <p className="mt-1 text-xs text-warning">
              This creates {questions.length} real assessment question{questions.length === 1 ? "" : "s"}
              . You can still edit or delete individual questions afterward from the assessment page.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
                {isPending ? "Approving…" : "Yes, approve"}
              </button>
              <button
                type="button"
                onClick={() => setIsConfirming(false)}
                disabled={isPending}
                className={buttonClass("secondary", "sm")}
              >
                Keep reviewing
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
