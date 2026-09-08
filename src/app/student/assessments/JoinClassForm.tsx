"use client";

import { useActionState } from "react";
import { joinClassWithCode, type JoinClassState } from "./joinClassActions";
import { buttonClass } from "@/components/ui/styles";

const initialState: JoinClassState = {};

/**
 * Where a student enrols themselves in a class using the code their teacher
 * gave them. Until they belong to a class, no assessment can reach them, so
 * this is shown prominently when they have nothing rather than buried.
 */
export default function JoinClassForm({ prominent = false }: { prominent?: boolean }) {
  const [state, formAction, pending] = useActionState(joinClassWithCode, initialState);

  return (
    <form action={formAction} className={prominent ? "mx-auto max-w-sm text-left" : "max-w-sm"}>
      <label htmlFor="joinCode" className="block text-sm font-medium text-foreground">
        Class code
      </label>
      <p className="mt-1 text-xs text-muted">
        Ask your teacher for the code for your class, then enter it once.
      </p>

      <div className="mt-2 flex gap-2">
        <input
          id="joinCode"
          name="joinCode"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="e.g. 7KQ2MB"
          className="w-40 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm uppercase tracking-widest placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-subtle"
        />
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Joining…" : "Join class"}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="mt-2 text-sm text-success">
          {state.success}
        </p>
      )}
    </form>
  );
}
