"use client";

import { useActionState, useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/styles";
import { saveRubricVersion, type ActionState } from "./actions";

type Approach = { label: string; description: string };
type Checkpoint = { description: string; marks: string };

type ActiveVersion = {
  versionNumber: number;
  solutionApproaches: unknown[];
  markingCheckpoints: unknown[];
} | null;

const initialState: ActionState = {};

function toApproaches(raw: unknown[]): Approach[] {
  return raw.map((item) => {
    const record = item as { label?: unknown; description?: unknown };
    return {
      label: typeof record.label === "string" ? record.label : "",
      description: typeof record.description === "string" ? record.description : "",
    };
  });
}

function toCheckpoints(raw: unknown[]): Checkpoint[] {
  return raw.map((item) => {
    const record = item as { description?: unknown; marks?: unknown };
    return {
      description: typeof record.description === "string" ? record.description : "",
      marks: record.marks !== undefined ? String(record.marks) : "",
    };
  });
}

export default function RubricEditor({
  questionId,
  activeVersion,
}: {
  questionId: string;
  activeVersion: ActiveVersion;
}) {
  const action = saveRubricVersion.bind(null, questionId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const [approaches, setApproaches] = useState<Approach[]>(
    activeVersion && activeVersion.solutionApproaches.length > 0
      ? toApproaches(activeVersion.solutionApproaches)
      : [{ label: "", description: "" }],
  );
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(
    activeVersion && activeVersion.markingCheckpoints.length > 0
      ? toCheckpoints(activeVersion.markingCheckpoints)
      : [{ description: "", marks: "" }],
  );

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col gap-5 rounded-lg border border-line bg-surface-muted p-4"
    >
      {activeVersion ? (
        <p className="text-xs text-muted">
          Editing saves a new version (v{activeVersion.versionNumber + 1}). Version{" "}
          {activeVersion.versionNumber} is kept as history, and results already evaluated against
          it stay pinned to it.
        </p>
      ) : (
        <p className="text-xs text-muted">
          The rubric is what answers are marked against: the approaches you accept, and the
          checkpoints that earn marks.
        </p>
      )}

      <div>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Accepted solution approaches
          </h4>
          <button
            type="button"
            onClick={() => setApproaches((a) => [...a, { label: "", description: "" }])}
            className="text-xs font-medium text-accent-text hover:underline"
          >
            + Add approach
          </button>
        </div>
        <p className="mt-1 text-xs text-subtle">
          Different valid ways to answer. An answer matching none of these may be flagged as a
          possible new approach.
        </p>
        <div className="mt-2.5 flex flex-col gap-2">
          {approaches.map((approach, index) => (
            <div key={index} className="flex gap-2">
              {/* Fixed-width wrapper, not a width utility on the input itself:
                  inputClass already carries w-full, and combining it with a
                  sibling width class (w-44 here) on the same element left the
                  actual width up to Tailwind's utility ordering rather than
                  this element's className order — it rendered wrong. A sized
                  wrapper sidesteps the conflict entirely. */}
              <div className="w-44 shrink-0">
                <input
                  value={approach.label}
                  onChange={(e) =>
                    setApproaches((prev) =>
                      prev.map((a, i) => (i === index ? { ...a, label: e.target.value } : a)),
                    )
                  }
                  placeholder="Label (e.g. Algebraic method)"
                  aria-label={`Approach ${index + 1} label`}
                  className={`${inputClass} py-1.5`}
                />
              </div>
              <div className="flex-1">
                <input
                  value={approach.description}
                  onChange={(e) =>
                    setApproaches((prev) =>
                      prev.map((a, i) =>
                        i === index ? { ...a, description: e.target.value } : a,
                      ),
                    )
                  }
                  placeholder="Describe this valid approach"
                  aria-label={`Approach ${index + 1} description`}
                  className={`${inputClass} py-1.5`}
                />
              </div>
              <button
                type="button"
                onClick={() => setApproaches((prev) => prev.filter((_, i) => i !== index))}
                className="shrink-0 rounded-md px-2 py-1.5 text-sm text-subtle hover:bg-danger-soft hover:text-danger"
                aria-label={`Remove approach ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Marking checkpoints
          </h4>
          <button
            type="button"
            onClick={() => setCheckpoints((c) => [...c, { description: "", marks: "" }])}
            className="text-xs font-medium text-accent-text hover:underline"
          >
            + Add checkpoint
          </button>
        </div>
        <p className="mt-1 text-xs text-subtle">
          What specifically earns marks. Each checkpoint is evaluated separately, with the evidence
          it found shown back to you.
        </p>
        <div className="mt-2.5 flex flex-col gap-2">
          {checkpoints.map((checkpoint, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1">
                <input
                  value={checkpoint.description}
                  onChange={(e) =>
                    setCheckpoints((prev) =>
                      prev.map((c, i) =>
                        i === index ? { ...c, description: e.target.value } : c,
                      ),
                    )
                  }
                  placeholder="What earns marks here?"
                  aria-label={`Checkpoint ${index + 1} description`}
                  className={`${inputClass} py-1.5`}
                />
              </div>
              <div className="w-24 shrink-0">
                <input
                  value={checkpoint.marks}
                  onChange={(e) =>
                    setCheckpoints((prev) =>
                      prev.map((c, i) => (i === index ? { ...c, marks: e.target.value } : c)),
                    )
                  }
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="Marks"
                  aria-label={`Checkpoint ${index + 1} marks`}
                  className={`${inputClass} py-1.5`}
                />
              </div>
              <button
                type="button"
                onClick={() => setCheckpoints((prev) => prev.filter((_, i) => i !== index))}
                className="shrink-0 rounded-md px-2 py-1.5 text-sm text-subtle hover:bg-danger-soft hover:text-danger"
                aria-label={`Remove checkpoint ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <input type="hidden" name="approachesJson" value={JSON.stringify(approaches)} />
      <input type="hidden" name="checkpointsJson" value={JSON.stringify(checkpoints)} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={isPending} className={buttonClass("primary", "sm")}>
          {isPending ? "Saving…" : activeVersion ? "Save as new version" : "Create rubric"}
        </button>
        {state.error && <p className="text-sm font-medium text-danger">{state.error}</p>}
        {state.success && <p className="text-sm font-medium text-success">Rubric saved.</p>}
      </div>
    </form>
  );
}
