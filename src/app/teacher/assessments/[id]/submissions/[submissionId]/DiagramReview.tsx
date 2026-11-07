"use client";

import { useRef, useState } from "react";
import { useActionState } from "react";
import StatusBadge from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import { boxFromDrag, type CropBox } from "@/lib/figures/cropBox";
import { redraftDiagramAction, removeCropAction, saveCropAction, type ActionState } from "./actions";

const initial: ActionState = {};

export interface CropView {
  id: string;
  pageNumber: number;
  confident: boolean;
  foundByInk: boolean;
  foundByModel: boolean;
  adjustedByTeacher: boolean;
  box: CropBox;
}

export interface ReferenceView {
  id: string;
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM";
}

export interface PageView {
  id: string;
  pageNumber: number;
}

/** How sure the finder was of where a diagram is, in words a teacher can act on. */
export function cropCertainty(crop: Pick<CropView, "confident" | "foundByInk" | "foundByModel" | "adjustedByTeacher">): { label: string; tone: "success" | "warning" } {
  if (crop.adjustedByTeacher) return { label: "Drawn by you", tone: "success" };
  if (crop.confident) return { label: "Found two ways, and they agree", tone: "success" };
  if (crop.foundByInk && !crop.foundByModel) return { label: "Not certain: found only by looking at the marks on the page", tone: "warning" };
  if (crop.foundByModel && !crop.foundByInk) return { label: "Not certain: found only by the AI's reading of the page", tone: "warning" };
  return { label: "Not certain: the two ways of finding it did not agree", tone: "warning" };
}

function cropUrl(submissionId: string, cropId: string) {
  return `/api/teacher/submissions/${submissionId}/diagram-crops/${cropId}`;
}

/**
 * Draws a box on the student's own page. The teacher presses where the diagram starts, drags to where it ends and lets go;
 * the box is kept as fractions of the page, so it does not depend on the size it is shown at.
 */
function CropEditor({
  submissionId,
  questionId,
  crop,
  pages,
  onDone,
}: {
  submissionId: string;
  questionId: string;
  crop: CropView | null;
  pages: PageView[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveCropAction.bind(null, submissionId, questionId, crop?.id ?? null), initial);
  const [pageNumber, setPageNumber] = useState(crop?.pageNumber ?? pages[0]?.pageNumber ?? 1);
  const [box, setBox] = useState<CropBox | null>(crop && crop.pageNumber === pageNumber ? crop.box : null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const page = pages.find((p) => p.pageNumber === pageNumber) ?? pages[0];

  const point = (event: React.PointerEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  return (
    <form action={action} className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
      <p className="text-sm font-medium">Draw a box around the whole diagram</p>
      <p className="mt-0.5 text-xs text-muted">Press where the diagram starts, drag to where it ends, and let go. Include its labels. You can draw it again as often as you like.</p>

      {pages.length > 1 && (
        <label className="mt-2 flex items-center gap-2 text-xs font-medium text-muted">
          Page
          <select
            value={pageNumber}
            onChange={(event) => {
              setPageNumber(Number(event.target.value));
              setBox(null);
            }}
            className="rounded-md border border-line bg-surface p-1 text-sm text-foreground"
          >
            {pages.map((p) => (
              <option key={p.id} value={p.pageNumber}>
                Page {p.pageNumber}
              </option>
            ))}
          </select>
        </label>
      )}

      {page && (
        <div
          ref={surface}
          className="relative mt-2 inline-block max-w-full cursor-crosshair touch-none select-none overflow-hidden rounded border border-line"
          onPointerDown={(event) => {
            const start = point(event);
            if (!start) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = start;
            setBox(boxFromDrag(start, start));
          }}
          onPointerMove={(event) => {
            const now = point(event);
            if (dragStart.current && now) setBox(boxFromDrag(dragStart.current, now));
          }}
          onPointerUp={() => {
            dragStart.current = null;
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static asset */}
          <img src={`/api/teacher/submissions/${submissionId}/answer-sheets/${page.id}`} alt={`Page ${page.pageNumber} of the answer sheet`} draggable={false} className="block max-h-[70vh] w-auto max-w-full" />
          {box && (
            <div
              aria-label="Selected diagram area"
              className="pointer-events-none absolute border-2 border-accent bg-accent/15"
              style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
            />
          )}
        </div>
      )}

      <input type="hidden" name="pageNumber" value={pageNumber} />
      <input type="hidden" name="left" value={box?.left ?? ""} />
      <input type="hidden" name="top" value={box?.top ?? ""} />
      <input type="hidden" name="width" value={box?.width ?? ""} />
      <input type="hidden" name="height" value={box?.height ?? ""} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !box} className={buttonClass("primary", "sm")}>
          {pending ? "Saving…" : "Save this crop"}
        </button>
        <button type="button" onClick={onDone} className={buttonClass("ghost", "sm")}>
          Close
        </button>
        {state.error && <span role="alert" className="text-xs font-medium text-danger">{state.error}</span>}
        {state.success && <span role="status" className="text-xs font-medium text-success">{state.success}</span>}
      </div>
    </form>
  );
}

function RemoveCropButton({ submissionId, cropId }: { submissionId: string; cropId: string }) {
  const [state, action, pending] = useActionState(removeCropAction.bind(null, submissionId, cropId), initial);
  return (
    <form action={action} className="inline">
      <button type="submit" disabled={pending} className="text-xs font-medium text-danger hover:underline">
        {pending ? "Removing…" : "This is not a diagram: remove"}
      </button>
      {state.error && <span role="alert" className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}

function CheckAgain({ submissionId, responseId }: { submissionId: string; responseId: string }) {
  const [state, action, pending] = useActionState(redraftDiagramAction.bind(null, submissionId, responseId), initial);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
        {pending ? "Checking the diagram… (about 20 seconds)" : "Check this diagram again"}
      </button>
      {state.error && <span role="alert" className="text-xs font-medium text-danger">{state.error}</span>}
      {state.success && <span role="status" className="text-xs font-medium text-success">{state.success}</span>}
    </form>
  );
}

/**
 * The diagram of one answer, on the review screen: what the student drew (cropped from their page) beside what to compare
 * it with, how sure the finder was of where it is, a tool to correct the crop, and a way to have it checked again once the
 * crop is right. The checklist, the checker's descriptions and the draft mark are shown by the answer card as for any answer.
 */
export default function DiagramReview({
  assessmentId,
  submissionId,
  questionId,
  questionNumber,
  responseId,
  crops,
  references,
  pages,
  locked,
  decided,
}: {
  assessmentId: string;
  submissionId: string;
  questionId: string;
  questionNumber: number;
  responseId: string | null;
  crops: CropView[];
  references: ReferenceView[];
  pages: PageView[];
  /** The marks are confirmed: nothing here can be changed. */
  locked: boolean;
  /** The teacher has already decided this answer: it cannot be checked again. */
  decided: boolean;
}) {
  const [editing, setEditing] = useState<"none" | "new" | string>("none");
  const uncertain = crops.some((crop) => !crop.confident && !crop.adjustedByTeacher);
  const canCheckAgain = !locked && !decided && responseId !== null && crops.length > 0;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">The diagram</p>

      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted">What the student drew</p>
          {crops.length === 0 ? (
            <p className="mt-1.5 rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning">
              No diagram could be found for this answer on the sheet. {!locked && "Draw a box around it on the page, and the AI will check it."}
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-3">
              {crops.map((crop) => {
                const certainty = cropCertainty(crop);
                return (
                  <li key={crop.id} className="rounded-lg border border-line bg-surface p-2">
                    <a href={cropUrl(submissionId, crop.id)} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static asset */}
                      <img src={cropUrl(submissionId, crop.id)} alt={`The student's diagram, from page ${crop.pageNumber}`} className="max-h-64 w-full rounded bg-white object-contain" />
                    </a>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge label={certainty.label} tone={certainty.tone} size="sm" />
                      <span className="text-xs text-subtle">page {crop.pageNumber}</span>
                    </div>
                    {!locked && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setEditing(editing === crop.id ? "none" : crop.id)} className="text-xs font-medium text-accent-text hover:underline">
                          {editing === crop.id ? "Close the crop tool" : "The crop is wrong: redraw it"}
                        </button>
                        <RemoveCropButton submissionId={submissionId} cropId={crop.id} />
                      </div>
                    )}
                    {editing === crop.id && <CropEditor submissionId={submissionId} questionId={questionId} crop={crop} pages={pages} onDone={() => setEditing("none")} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted">What to compare it with</p>
          {references.length === 0 ? (
            <p className="mt-1.5 rounded-lg border border-line bg-surface-muted p-3 text-sm text-muted">
              No model diagram or figure is attached to this question, so the AI could only judge the drawing from the checklist, and the answer is always flagged.{" "}
              <a href={`/teacher/assessments/${assessmentId}#question-${questionNumber}`} className="font-medium text-accent-text hover:underline">
                Add one on the question
              </a>
              .
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-3">
              {references.map((reference) => (
                <li key={reference.id} className="rounded-lg border border-line bg-surface p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from an auth-scoped route, not a static asset */}
                  <img src={`/api/teacher/assessments/${assessmentId}/figures/${reference.id}`} alt={reference.role === "MODEL_DIAGRAM" ? "Model diagram" : "Figure from the question paper"} className="max-h-64 w-full rounded bg-white object-contain" />
                  <p className="mt-1.5 text-xs text-muted">{reference.role === "MODEL_DIAGRAM" ? "Your model diagram" : "Figure printed in the question paper"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {uncertain && (
        <p className="mt-3 text-xs text-warning">
          The finder was not certain where this diagram is, so the crop may be wrong. If it is, redraw it and ask for the diagram to be checked again.
        </p>
      )}

      {!locked && crops.length === 0 && pages.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setEditing(editing === "new" ? "none" : "new")} className={buttonClass("secondary", "sm")}>
            {editing === "new" ? "Close the crop tool" : "Draw the diagram's box on the page"}
          </button>
          {editing === "new" && <CropEditor submissionId={submissionId} questionId={questionId} crop={null} pages={pages} onDone={() => setEditing("none")} />}
        </div>
      )}

      {canCheckAgain && <CheckAgain submissionId={submissionId} responseId={responseId} />}
      {decided && !locked && <p className="mt-2 text-xs text-muted">You have already decided this answer, so it cannot be checked again. Reopen your decision to change it.</p>}
    </div>
  );
}
