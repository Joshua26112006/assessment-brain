"use client";

import { useActionState, useState } from "react";
import {
  buttonClass,
  fieldErrorClass,
  helpTextClass,
  inputClass,
  labelClass,
} from "@/components/ui/styles";
import { createAssessment, type CreateAssessmentState } from "./actions";

type ClassOption = {
  id: string;
  name: string;
  grade: string;
  section: string | null;
};

const initialState: CreateAssessmentState = {};

export default function CreateAssessmentForm({ classes }: { classes: ClassOption[] }) {
  const [state, formAction, isPending] = useActionState(createAssessment, initialState);
  const [classMode, setClassMode] = useState<"existing" | "new">(
    classes.length > 0 ? "existing" : "new",
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="rounded-xl border border-line bg-surface p-5">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Assessment details
        </legend>

        <div className="mt-2">
          <label htmlFor="title" className={labelClass}>
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="e.g. Unit 3 — Cell Biology"
            className={`${inputClass} mt-1.5`}
          />
          {state.fieldErrors?.title && (
            <p className={fieldErrorClass}>{state.fieldErrors.title}</p>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="subject" className={labelClass}>
              Subject
            </label>
            <input
              id="subject"
              name="subject"
              type="text"
              placeholder="e.g. Biology"
              className={`${inputClass} mt-1.5`}
            />
            {state.fieldErrors?.subject && (
              <p className={fieldErrorClass}>{state.fieldErrors.subject}</p>
            )}
          </div>

          <div>
            <label htmlFor="grade" className={labelClass}>
              Grade
            </label>
            <input
              id="grade"
              name="grade"
              type="text"
              placeholder="e.g. Grade 9"
              className={`${inputClass} mt-1.5`}
            />
            {state.fieldErrors?.grade && (
              <p className={fieldErrorClass}>{state.fieldErrors.grade}</p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="curriculum" className={labelClass}>
            Curriculum
          </label>
          <input
            id="curriculum"
            name="curriculum"
            type="text"
            placeholder="e.g. CBSE, IB, Cambridge"
            className={`${inputClass} mt-1.5`}
          />
          <p className={helpTextClass}>Recorded with the assessment for context.</p>
          {state.fieldErrors?.curriculum && (
            <p className={fieldErrorClass}>{state.fieldErrors.curriculum}</p>
          )}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line bg-surface p-5">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Class
        </legend>
        <p className="mt-2 text-sm text-muted">
          Every assessment belongs to one class. Only students in that class will be able to see
          it once it&apos;s published.
        </p>

        {classes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="classMode"
                checked={classMode === "existing"}
                onChange={() => setClassMode("existing")}
              />
              Use an existing class
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="classMode"
                checked={classMode === "new"}
                onChange={() => setClassMode("new")}
              />
              Create a new class
            </label>
          </div>
        )}

        {classMode === "existing" && classes.length > 0 ? (
          <>
            <label htmlFor="classId" className="sr-only">
              Select a class
            </label>
            <select id="classId" name="classId" defaultValue="" className={`${inputClass} mt-3`}>
              <option value="" disabled>
                Select a class
              </option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.grade}
                  {cls.section ? ` - ${cls.section}` : ""})
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="newClassName" className="sr-only">
              New class name
            </label>
            <input
              id="newClassName"
              name="newClassName"
              type="text"
              placeholder="New class name, e.g. Section A"
              className={`${inputClass} mt-3`}
            />
          </>
        )}
        {state.fieldErrors?.classId && (
          <p className={fieldErrorClass}>{state.fieldErrors.classId}</p>
        )}
      </fieldset>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={isPending} className={buttonClass("primary")}>
          {isPending ? "Creating…" : "Create assessment"}
        </button>
        <p className="text-xs text-subtle">
          You&apos;ll add questions and rubrics next. Nothing is visible to students until you
          publish.
        </p>
      </div>
    </form>
  );
}
