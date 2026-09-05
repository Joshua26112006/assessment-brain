"use client";

import { useActionState, useState } from "react";
import { createAssessment, type CreateAssessmentState } from "./actions";

type ClassOption = {
  id: string;
  name: string;
  grade: string;
  section: string | null;
};

const initialState: CreateAssessmentState = {};

export default function CreateAssessmentForm({
  classes,
}: {
  classes: ClassOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    createAssessment,
    initialState,
  );
  const [classMode, setClassMode] = useState<"existing" | "new">(
    classes.length > 0 ? "existing" : "new",
  );

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="title" className="block text-sm font-medium">
          Assessment Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        {state.fieldErrors?.title && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.title}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="subject" className="block text-sm font-medium">
            Subject
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            placeholder="e.g. Biology"
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          {state.fieldErrors?.subject && (
            <p className="mt-1 text-sm text-red-600">{state.fieldErrors.subject}</p>
          )}
        </div>

        <div>
          <label htmlFor="grade" className="block text-sm font-medium">
            Grade
          </label>
          <input
            id="grade"
            name="grade"
            type="text"
            placeholder="e.g. Grade 9"
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
          {state.fieldErrors?.grade && (
            <p className="mt-1 text-sm text-red-600">{state.fieldErrors.grade}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="curriculum" className="block text-sm font-medium">
          Curriculum
        </label>
        <input
          id="curriculum"
          name="curriculum"
          type="text"
          placeholder="e.g. CBSE, IB, Cambridge"
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        {state.fieldErrors?.curriculum && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.curriculum}</p>
        )}
      </div>

      <div className="rounded-md border border-black/10 p-4 dark:border-white/15">
        <span className="block text-sm font-medium">Class</span>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          Every assessment belongs to one class of students.
        </p>

        {classes.length > 0 && (
          <div className="mt-3 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={classMode === "existing"}
                onChange={() => setClassMode("existing")}
              />
              Use an existing class
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={classMode === "new"}
                onChange={() => setClassMode("new")}
              />
              Create a new class
            </label>
          </div>
        )}

        {classMode === "existing" && classes.length > 0 ? (
          <select
            name="classId"
            defaultValue=""
            className="mt-3 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          >
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
        ) : (
          <input
            name="newClassName"
            type="text"
            placeholder="New class name, e.g. Section A"
            className="mt-3 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          />
        )}
        {state.fieldErrors?.classId && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.classId}</p>
        )}
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {isPending ? "Creating..." : "Create Assessment"}
      </button>
    </form>
  );
}
