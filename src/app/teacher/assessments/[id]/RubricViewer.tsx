import type { ReactNode } from "react";
import StatusBadge from "@/components/ui/StatusBadge";

export interface RubricViewerApproach {
  label: string;
  description: string;
  steps: string[];
  isPrimary: boolean;
}

export interface RubricViewerCheckpoint {
  description: string;
  marks: number;
}

export interface RubricViewerData {
  versionNumber: number;
  expectedAnswer: string | null;
  solutionApproaches: RubricViewerApproach[];
  markingCheckpoints: RubricViewerCheckpoint[];
  partialCreditGuidance: string | null;
}

/**
 * Safely parses RubricVersion.solutionApproaches (untyped Json) into the
 * shape this viewer (and RubricEditor's manual-override path) expects.
 * Shared by every server component that reads a RubricVersion for display
 * (the assessment detail page, and the Phase 4.3 consolidated rubric page)
 * so there's exactly one place that defines "what a solution approach
 * looks like once read back from the database."
 */
export function parseRubricApproaches(raw: unknown): RubricViewerApproach[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      label: typeof record.label === "string" ? record.label : "",
      description: typeof record.description === "string" ? record.description : "",
      steps: Array.isArray(record.steps)
        ? record.steps.filter((s): s is string => typeof s === "string")
        : [],
      isPrimary: record.isPrimary === true,
    };
  });
}

/** Same as parseRubricApproaches, for RubricVersion.markingCheckpoints. */
export function parseRubricCheckpoints(raw: unknown): RubricViewerCheckpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      description: typeof record.description === "string" ? record.description : "",
      marks: typeof record.marks === "number" ? record.marks : Number(record.marks) || 0,
    };
  });
}

/**
 * Read-only, polished display of a question's active rubric — the primary
 * way a teacher now inspects marking intelligence (Phase 4.1 Step 5),
 * replacing the manual editor as the default view. Deliberately read-only:
 * this component never lets a teacher edit rubric content directly, since
 * the normal workflow no longer expects that (see QuestionCard's separate
 * "Edit manually" disclosure, kept only as a backward-compatible advanced
 * override, for the rare case a teacher wants to override the AI directly).
 *
 * Every section is optional in the data (a manually-saved legacy rubric may
 * have no expectedAnswer/partialCreditGuidance, and solutionApproaches may
 * carry only label/description with no steps) — this renders gracefully
 * around whatever is actually present rather than assuming AI-shaped data.
 */
export default function RubricViewer({ rubric }: { rubric: RubricViewerData }) {
  const primary = rubric.solutionApproaches.find((a) => a.isPrimary) ?? rubric.solutionApproaches[0];
  const alternatives = rubric.solutionApproaches.filter((a) => a !== primary);
  const totalMarks = rubric.markingCheckpoints.reduce((sum, c) => sum + c.marks, 0);

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-accent-soft">
      <div className="flex items-center justify-between gap-3 bg-accent-soft px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent-text">
          Assessment Brain Rubric
        </span>
        <StatusBadge label={`v${rubric.versionNumber}`} tone="accent" size="sm" />
      </div>

      <div className="flex flex-col divide-y divide-line bg-surface">
        {rubric.expectedAnswer && (
          <Section title="Expected answer">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{rubric.expectedAnswer}</p>
          </Section>
        )}

        {primary && (
          <Section title="Solution approach">
            {primary.label && <p className="text-sm font-medium">{primary.label}</p>}
            {primary.description && (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {primary.description}
              </p>
            )}
            {primary.steps.length > 0 && (
              <ol className="mt-2.5 flex flex-col gap-1.5">
                {primary.steps.map((step, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-relaxed">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted"
                    >
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        )}

        {alternatives.length > 0 && (
          <Section title="Alternative valid approaches">
            <ul className="flex flex-col gap-3">
              {alternatives.map((approach, index) => (
                <li key={index}>
                  {approach.label && <p className="text-sm font-medium">{approach.label}</p>}
                  {approach.description && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                      {approach.description}
                    </p>
                  )}
                  {approach.steps.length > 0 && (
                    <ol className="mt-1.5 flex flex-col gap-1 pl-4 text-sm text-muted">
                      {approach.steps.map((step, stepIndex) => (
                        <li key={stepIndex} className="list-decimal">
                          {step}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {rubric.markingCheckpoints.length > 0 && (
          <Section title="Marking breakdown">
            <ul className="flex flex-col gap-1.5">
              {rubric.markingCheckpoints.map((checkpoint, index) => (
                <li key={index} className="flex items-start justify-between gap-4 text-sm">
                  <span className="leading-relaxed">
                    <span aria-hidden="true" className="mr-1.5 text-success">
                      ✓
                    </span>
                    {checkpoint.description}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {checkpoint.marks} mark{checkpoint.marks === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {totalMarks} mark{totalMarks === 1 ? "" : "s"}
              </span>
            </div>
          </Section>
        )}

        {rubric.partialCreditGuidance && (
          <Section title="Partial credit guidance">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {rubric.partialCreditGuidance}
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}
