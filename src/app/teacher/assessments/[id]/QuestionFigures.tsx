"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/styles";
import {
  assignFigureAction,
  redetectFiguresAction,
  removeFigureAction,
  uploadFigureAction,
  type FigureActionState,
} from "./figureActions";

const initial: FigureActionState = {};

export type FigureItem = {
  id: string;
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM";
  source: "PDF_DETECTED" | "TEACHER_UPLOAD";
  pageNumber: number | null;
};

function figureUrl(assessmentId: string, figureId: string) {
  return `/api/teacher/assessments/${assessmentId}/figures/${figureId}`;
}

function Thumbnail({ assessmentId, figure, children }: { assessmentId: string; figure: FigureItem; children?: React.ReactNode }) {
  return (
    <li className="w-44 rounded-lg border border-line bg-surface p-2">
      <a href={figureUrl(assessmentId, figure.id)} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static asset */}
        <img src={figureUrl(assessmentId, figure.id)} alt={figure.role === "MODEL_DIAGRAM" ? "Model diagram" : "Figure from the question paper"} className="h-28 w-full rounded object-contain bg-white" />
      </a>
      <p className="mt-1 text-xs text-muted">
        {figure.role === "MODEL_DIAGRAM" ? "Model diagram" : figure.source === "PDF_DETECTED" ? `Figure from the paper${figure.pageNumber ? ` (page ${figure.pageNumber})` : ""}` : "Figure you added"}
      </p>
      {children}
    </li>
  );
}

function RemoveButton({ assessmentId, figureId }: { assessmentId: string; figureId: string }) {
  const [state, action, pending] = useActionState(removeFigureAction.bind(null, assessmentId, figureId), initial);
  return (
    <form action={action} className="mt-1">
      <button type="submit" disabled={pending} className="text-xs font-medium text-danger hover:underline">
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

function UploadForm({ assessmentId, questionId, role, label, hint }: { assessmentId: string; questionId: string; role: "QUESTION_FIGURE" | "MODEL_DIAGRAM"; label: string; hint: string }) {
  const [state, action, pending] = useActionState(uploadFigureAction.bind(null, assessmentId, questionId, role), initial);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted">
        {label}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block text-xs" />
      </label>
      <p className="text-xs text-subtle">{hint}</p>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
          {pending ? "Uploading…" : "Upload"}
        </button>
        {state.error && <span role="alert" className="text-xs font-medium text-danger">{state.error}</span>}
        {state.success && <span role="status" className="text-xs font-medium text-success">{state.success}</span>}
      </div>
    </form>
  );
}

/**
 * The pictures of one question: the figures, graphs and tables printed in the paper (found automatically from a digital
 * PDF, or added by the teacher) and a model diagram for a question where the student draws. The scheme drafter is given
 * all of them, so the scheme is no longer a guess about a figure it could not see.
 */
export default function QuestionFigures({
  assessmentId,
  questionId,
  figures,
  mentionsFigure,
  isDiagramQuestion,
}: {
  assessmentId: string;
  questionId: string;
  figures: FigureItem[];
  mentionsFigure: boolean;
  isDiagramQuestion: boolean;
}) {
  const printed = figures.filter((f) => f.role === "QUESTION_FIGURE");
  const models = figures.filter((f) => f.role === "MODEL_DIAGRAM");
  const needsAttention = (mentionsFigure && printed.length === 0) || (isDiagramQuestion && models.length === 0);

  if (figures.length === 0 && !mentionsFigure && !isDiagramQuestion) {
    return (
      <details className="border-t border-line px-5 py-2">
        <summary className="cursor-pointer text-xs font-medium text-subtle hover:text-foreground">Add a figure or model diagram</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <UploadForm assessmentId={assessmentId} questionId={questionId} role="QUESTION_FIGURE" label="A figure, graph or table this question refers to" hint="Shown to the scheme drafter, so it can see what the question shows." />
          <UploadForm assessmentId={assessmentId} questionId={questionId} role="MODEL_DIAGRAM" label="A model diagram (the correct drawing)" hint="For a question where the student draws. The scheme's checklist is drafted from it." />
        </div>
      </details>
    );
  }

  return (
    <div className="border-t border-line px-5 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Figures and model diagram</p>
      {needsAttention && (
        <p role="note" className="mt-2 rounded-lg border border-warning-line bg-warning-soft p-2 text-xs text-warning">
          {mentionsFigure && printed.length === 0
            ? "This question points at a figure but none is attached. Upload it below so the scheme can be drafted from what it shows."
            : "This is a question where the student draws. Upload a model diagram below so the scheme's checklist can be drafted from it."}
        </p>
      )}
      {figures.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-3">
          {figures.map((figure) => (
            <Thumbnail key={figure.id} assessmentId={assessmentId} figure={figure}>
              <RemoveButton assessmentId={assessmentId} figureId={figure.id} />
            </Thumbnail>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <UploadForm assessmentId={assessmentId} questionId={questionId} role="QUESTION_FIGURE" label="Add or replace a figure from the paper" hint="Use this if the figure was missed or badly cropped." />
        <UploadForm assessmentId={assessmentId} questionId={questionId} role="MODEL_DIAGRAM" label="Add a model diagram" hint="The correct drawing for a question where the student draws." />
      </div>
    </div>
  );
}

function AssignForm({ assessmentId, figureId, questions }: { assessmentId: string; figureId: string; questions: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState(assignFigureAction.bind(null, assessmentId, figureId), initial);
  return (
    <form action={action} className="mt-1 flex flex-col gap-1">
      <select name="questionId" defaultValue="" className="rounded-md border border-line bg-surface p-1 text-xs text-foreground">
        <option value="" disabled>Belongs to…</option>
        {questions.map((q) => (
          <option key={q.id} value={q.id}>Question {q.label}</option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>{pending ? "Placing…" : "Place"}</button>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Figures found in the paper that follow no question number, for the teacher to place or remove; and the button to look again. */
export function FigureTray({
  assessmentId,
  unplaced,
  questions,
  canDetect,
}: {
  assessmentId: string;
  unplaced: FigureItem[];
  questions: Array<{ id: string; label: string }>;
  canDetect: boolean;
}) {
  const [state, action, pending] = useActionState(redetectFiguresAction.bind(null, assessmentId), initial);
  if (unplaced.length === 0 && !canDetect) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      {canDetect && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
            {pending ? "Looking…" : "Find the paper's figures again"}
          </button>
          {state.error && <span role="alert" className="text-xs font-medium text-danger">{state.error}</span>}
          {state.success && <span role="status" className="text-xs font-medium text-success">{state.success}</span>}
        </form>
      )}
      {unplaced.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">
            {unplaced.length === 1 ? "This figure was found" : "These figures were found"} in the paper but {unplaced.length === 1 ? "does not follow" : "do not follow"} a question number. Say which question {unplaced.length === 1 ? "it belongs" : "they belong"} to, or remove {unplaced.length === 1 ? "it" : "them"}.
          </p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {unplaced.map((figure) => (
              <Thumbnail key={figure.id} assessmentId={assessmentId} figure={figure}>
                <AssignForm assessmentId={assessmentId} figureId={figure.id} questions={questions} />
                <RemoveButton assessmentId={assessmentId} figureId={figure.id} />
              </Thumbnail>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
