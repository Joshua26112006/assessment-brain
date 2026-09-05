"use client";

import { useActionState, useState } from "react";
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
      className="mt-3 flex flex-col gap-4 rounded-md bg-black/[0.02] p-3 dark:bg-white/[0.03]"
    >
      {activeVersion && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Editing creates a new version (v{activeVersion.versionNumber + 1}).
          Version {activeVersion.versionNumber} is preserved as history.
        </p>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-black/60 dark:text-white/60">
            Accepted solution approaches
          </h4>
          <button
            type="button"
            onClick={() => setApproaches((a) => [...a, { label: "", description: "" }])}
            className="text-xs text-black/60 hover:underline dark:text-white/60"
          >
            + Add approach
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {approaches.map((approach, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={approach.label}
                onChange={(e) =>
                  setApproaches((prev) =>
                    prev.map((a, i) => (i === index ? { ...a, label: e.target.value } : a)),
                  )
                }
                placeholder="Label (e.g. Algebraic method)"
                className="w-40 rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
              />
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
                className="flex-1 rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
              />
              <button
                type="button"
                onClick={() => setApproaches((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs text-black/40 hover:text-red-600"
                aria-label="Remove approach"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-black/60 dark:text-white/60">
            Marking checkpoints
          </h4>
          <button
            type="button"
            onClick={() => setCheckpoints((c) => [...c, { description: "", marks: "" }])}
            className="text-xs text-black/60 hover:underline dark:text-white/60"
          >
            + Add checkpoint
          </button>
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {checkpoints.map((checkpoint, index) => (
            <div key={index} className="flex gap-2">
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
                className="flex-1 rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
              />
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
                className="w-24 rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/20"
              />
              <button
                type="button"
                onClick={() => setCheckpoints((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs text-black/40 hover:text-red-600"
                aria-label="Remove checkpoint"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <input type="hidden" name="approachesJson" value={JSON.stringify(approaches)} />
      <input type="hidden" name="checkpointsJson" value={JSON.stringify(checkpoints)} />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="w-fit rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {isPending
            ? "Saving..."
            : activeVersion
              ? "Save as new version"
              : "Create rubric"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.success && (
          <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>
        )}
      </div>
    </form>
  );
}
