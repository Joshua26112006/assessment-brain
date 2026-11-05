import { isHalfMarkMultiple, validateCriteria, type SchemeCriterion } from "@/lib/scheme/criteria";

/**
 * The manual rubric editor only knows descriptions and marks. Saving it used to
 * REPLACE the rubric with just those, silently dropping the expected answer, the
 * partial-credit guidance, the structured expectation and every approach's steps
 * — which changed how the question was routed and marked. These functions fold
 * the editor's changes into what was already there instead.
 *
 * Pure: no database.
 */

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export interface EditedCheckpoint {
  description: string;
  marks: number;
}

export type MergeResult = { ok: true; criteria: SchemeCriterion[] } | { ok: false; message: string };

/**
 * The criteria after a teacher edited the checkpoint list. A checkpoint whose
 * description matches an existing criterion keeps that criterion's kind, accepted
 * answers, unit and hint; a new one is a STEP. The teacher's marks are never
 * adjusted silently: they must be in half marks and add up to the question's marks.
 */
export function mergeCheckpointEdits(
  existing: SchemeCriterion[],
  edited: EditedCheckpoint[],
  maximumMarks: number,
): MergeResult {
  const unused = [...existing];
  const criteria: SchemeCriterion[] = edited.map((checkpoint, index) => {
    const matchIndex = unused.findIndex((criterion) => norm(criterion.description) === norm(checkpoint.description));
    const match = matchIndex >= 0 ? unused.splice(matchIndex, 1)[0] : null;
    return {
      ...(match ?? { kind: "STEP" as const }),
      id: match?.id ?? `n${index + 1}`,
      description: checkpoint.description.trim(),
      marks: checkpoint.marks,
      kind: match?.kind ?? "STEP",
    };
  });

  // Ids must be unique even when a new criterion's generated id would collide with a kept one.
  const seen = new Set<string>();
  criteria.forEach((criterion, index) => {
    let id = criterion.id;
    while (seen.has(id)) id = `${criterion.id}_${index}`;
    seen.add(id);
    criterion.id = id;
  });

  if (criteria.some((criterion) => !isHalfMarkMultiple(criterion.marks))) {
    return { ok: false, message: "Each checkpoint must be worth a multiple of 0.5 marks." };
  }
  const check = validateCriteria(criteria, maximumMarks);
  if (!check.ok) return { ok: false, message: check.errors[0] ?? "The checkpoints are not valid." };
  return { ok: true, criteria };
}

export interface StoredApproach {
  label: string;
  description: string;
  steps?: string[];
  isPrimary?: boolean;
}

/**
 * The approaches after an edit that only carries label and description. Steps and
 * which approach is primary are kept from the stored approach with the same label;
 * a brand-new approach has none. At least one approach stays primary.
 */
export function mergeApproachEdits(
  existing: StoredApproach[],
  edited: { label: string; description: string }[],
): StoredApproach[] {
  const merged = edited.map((approach): StoredApproach => {
    const match = existing.find((old) => norm(old.label) === norm(approach.label));
    return {
      label: approach.label,
      description: approach.description,
      steps: match?.steps ?? [],
      isPrimary: match?.isPrimary === true,
    };
  });
  if (merged.length > 0 && !merged.some((approach) => approach.isPrimary)) merged[0].isPrimary = true;
  return merged;
}
