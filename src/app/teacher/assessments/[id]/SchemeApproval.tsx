"use client";

import { useActionState } from "react";
import StatusBadge from "@/components/ui/StatusBadge";
import { buttonClass } from "@/components/ui/styles";
import { approveSchemeAction, saveSchemeRulesAction, type ActionState } from "./actions";

export type SchemeCriterionView = {
  id: string;
  kind: string;
  description: string;
  marks: number;
  unit?: string;
  accepted?: string[];
};

const KIND_LABEL: Record<string, string> = {
  STEP: "Method step",
  VALUE: "Correct value",
  FINAL_ANSWER: "Final answer",
  UNIT: "Unit",
  VALUE_POINT: "Key point",
  LEVEL: "Overall quality",
  EXACT_KEY: "Exact answer",
};

const FOLLOW_THROUGH_LABEL: Record<string, string> = {
  ALLOWED: "Allowed — a later step using an earlier wrong value still earns its mark",
  NOT_ALLOWED: "Not allowed — marks stop at the first error",
  METHOD_ONLY: "Method marks only — later method marks are given, accuracy marks are not",
};

const NO_WORKING_LABEL: Record<string, string> = {
  FINAL_ANSWER_ONLY: "Only the final answer's marks (and it is flagged for you)",
  FULL_MARKS: "Full marks (and it is flagged for you)",
};

const initial: ActionState = {};

/**
 * The teacher's view of one question's marking scheme: every criterion with its kind and marks, the two
 * rules the scheme states (follow-through, and what a correct answer with no working earns), and the
 * approve button. Nothing is marked against the scheme until it is approved (decision D8).
 */
export default function SchemeApproval({
  questionId,
  approved,
  criteria,
  followThrough,
  noWorkingRule,
}: {
  questionId: string;
  approved: boolean;
  criteria: SchemeCriterionView[];
  followThrough: string;
  noWorkingRule: string;
}) {
  const [approveState, approveAction, approving] = useActionState(approveSchemeAction.bind(null, questionId), initial);
  const [rulesState, rulesAction, savingRules] = useActionState(saveSchemeRulesAction.bind(null, questionId), initial);

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Marking scheme</h4>
        <StatusBadge label={approved ? "Approved by you" : "Waiting for your approval"} tone={approved ? "success" : "warning"} size="sm" />
      </div>
      <p className="mt-1 text-xs text-muted">
        {approved
          ? "Answers are marked against this scheme. Changing it marks unreviewed answers again; marks you have accepted are never changed."
          : "Nothing is marked until you approve this scheme. The question's marks are always the sum of these criteria."}
      </p>

      <ol className="mt-3 flex flex-col gap-1.5">
        {criteria.map((criterion) => (
          <li key={criterion.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 w-28 shrink-0 text-xs font-medium text-subtle">{KIND_LABEL[criterion.kind] ?? criterion.kind}</span>
            <span className="min-w-0 flex-1">
              {criterion.description}
              {criterion.unit ? <span className="text-xs text-muted"> (unit: {criterion.unit})</span> : null}
              {criterion.accepted && criterion.accepted.length > 0 ? (
                <span className="block text-xs text-muted">Accepted: {criterion.accepted.join(", ")}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs font-semibold tabular-nums">
              {criterion.marks} {criterion.marks === 1 ? "mark" : "marks"}
            </span>
          </li>
        ))}
      </ol>

      <form action={rulesAction} className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Follow-through
          <select name="followThrough" defaultValue={followThrough} className="rounded-md border border-line bg-surface p-2 text-sm text-foreground">
            {Object.entries(FOLLOW_THROUGH_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          A correct answer with no working earns
          <select name="noWorkingRule" defaultValue={noWorkingRule} className="rounded-md border border-line bg-surface p-2 text-sm text-foreground">
            {Object.entries(NO_WORKING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={savingRules} className={buttonClass("secondary", "sm")}>
            {savingRules ? "Saving…" : "Save these rules"}
          </button>
          {rulesState.error && <p className="mt-1.5 text-xs font-medium text-danger">{rulesState.error}</p>}
          {rulesState.success && <p role="status" className="mt-1.5 text-xs font-medium text-success">Rules saved.</p>}
        </div>
      </form>

      {!approved && (
        <form action={approveAction} className="mt-4">
          <button type="submit" disabled={approving} className={buttonClass("primary", "sm")}>
            {approving ? "Approving…" : "Approve this scheme"}
          </button>
          {approveState.error && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{approveState.error}</p>}
        </form>
      )}
    </div>
  );
}
