/**
 * The marking scheme as data (decisions D8 to D12 of 06-correction-hardening-plan.md).
 *
 * A scheme is a list of CRITERIA, each a yes/no check worth a set number of
 * marks in steps of half a mark. A question's mark is always the SUM of its
 * criteria (D9) — leniency lives in the scheme as explicit choices, never in a
 * hidden setting. The AI drafts the scheme; the teacher approves it (D8).
 *
 * Pure: no database, no framework.
 */

export const CRITERION_KINDS = [
  "STEP",
  "VALUE",
  "FINAL_ANSWER",
  "UNIT",
  "VALUE_POINT",
  "LEVEL",
  "EXACT_KEY",
] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export interface SchemeCriterion {
  id: string;
  kind: CriterionKind;
  description: string;
  /** A positive multiple of 0.5 (decision D12). */
  marks: number;
  /** A short pointer for whoever applies the criterion: where in the answer to look. */
  evidenceHint?: string;
  /** EXACT_KEY only: the key and every accepted variant ("B", "Nehru", "Jawaharlal Nehru"). */
  accepted?: string[];
  /** UNIT only: the unit the student must state. */
  unit?: string;
}

/** What happens to a later criterion earned using an earlier wrong value (decision D10). */
export const FOLLOW_THROUGH_RULES = ["ALLOWED", "NOT_ALLOWED", "METHOD_ONLY"] as const;
export type FollowThrough = (typeof FOLLOW_THROUGH_RULES)[number];

/** What a correct final answer with no working earns (decision D6). */
export const NO_WORKING_RULES = ["FINAL_ANSWER_ONLY", "FULL_MARKS"] as const;
export type NoWorkingRule = (typeof NO_WORKING_RULES)[number];

/**
 * School-wide defaults. The spec's own example is "follow-through allowed in
 * maths"; the plan's D6 is "final-answer marks only". Both are the owner's to
 * confirm — see 07-hardening-log.md.
 */
export const DEFAULT_FOLLOW_THROUGH: FollowThrough = "ALLOWED";
export const DEFAULT_NO_WORKING_RULE: NoWorkingRule = "FINAL_ANSWER_ONLY";

export interface Scheme {
  criteria: SchemeCriterion[];
  followThrough: FollowThrough;
  noWorkingRule: NoWorkingRule;
  acceptedAlternatives: string[];
}

/** Criteria whose result is decided by the student's METHOD rather than by the answer they reached. */
export const METHOD_KINDS: readonly CriterionKind[] = ["STEP", "VALUE", "VALUE_POINT", "LEVEL"];
/** Criteria that are about the answer itself. */
export const ANSWER_KINDS: readonly CriterionKind[] = ["FINAL_ANSWER", "UNIT", "EXACT_KEY"];

/**
 * Do the two scheme rules (follow-through, and what a correct answer with no working earns) mean anything for
 * this scheme? They do only where there is working to follow through or to be missing: a final answer plus at
 * least one step or value before it. A descriptive answer, an essay or an exact-answer question has neither,
 * so asking the teacher about them would be noise.
 */
export function rulesApply(criteria: Array<{ kind: string }>): boolean {
  const kinds = new Set(criteria.map((criterion) => criterion.kind));
  return kinds.has("FINAL_ANSWER") && (kinds.has("STEP") || kinds.has("VALUE"));
}

export const MARK_GRANULARITY = 0.5;

export function isHalfMarkMultiple(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const halves = value / MARK_GRANULARITY;
  return Math.abs(halves - Math.round(halves)) < 1e-9;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CriteriaValidation {
  ok: boolean;
  errors: string[];
}

/** Checks a scheme's criteria against the question's maximum marks. Never trusts AI or form input blindly. */
export function validateCriteria(criteria: SchemeCriterion[], maximumMarks: number): CriteriaValidation {
  const errors: string[] = [];

  if (!(maximumMarks > 0)) errors.push("The question's maximum marks must be a positive number.");
  if (criteria.length === 0) errors.push("Add at least one marking criterion.");

  const seen = new Set<string>();
  for (const [index, criterion] of criteria.entries()) {
    const label = `Criterion ${index + 1}`;
    if (!criterion.id || seen.has(criterion.id)) errors.push(`${label} has a missing or repeated id.`);
    seen.add(criterion.id);
    if (!(CRITERION_KINDS as readonly string[]).includes(criterion.kind)) errors.push(`${label} has an unknown kind.`);
    if (!criterion.description?.trim()) errors.push(`${label} needs a description.`);
    if (!(criterion.marks > 0)) errors.push(`${label} must be worth more than 0 marks.`);
    else if (!isHalfMarkMultiple(criterion.marks)) errors.push(`${label} must be worth a multiple of 0.5 marks.`);
    if (criterion.kind === "EXACT_KEY" && !(criterion.accepted && criterion.accepted.some((a) => a.trim()))) {
      errors.push(`${label} is an exact-answer criterion and needs at least one accepted answer.`);
    }
  }

  const total = round2(criteria.reduce((sum, criterion) => sum + (Number(criterion.marks) || 0), 0));
  if (maximumMarks > 0 && Math.abs(total - maximumMarks) > 1e-9) {
    errors.push(`The criteria add up to ${total} marks, but the question is worth ${maximumMarks}.`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Splits `total` marks across `weights` in whole half-marks, keeping each
 * proportion as close as it can and the sum EXACT. Largest remainder, so no
 * criterion is ever pushed negative and no mark is lost to rounding.
 */
export function snapToHalfMarks(weights: number[], total: number): number[] {
  const units = Math.round(total / MARK_GRANULARITY);
  const n = weights.length;
  if (n === 0) return [];

  const positive = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = positive.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? positive.map((w) => (w / sum) * units) : positive.map(() => units / n);

  const floors = shares.map(Math.floor);
  let remaining = units - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let i = 0; remaining > 0 && order.length > 0; i = (i + 1) % order.length, remaining--) {
    floors[order[i].index]++;
  }
  return floors.map((count) => count * MARK_GRANULARITY);
}

/** Older rubrics store `markingCheckpoints` (description + marks). They read as STEP criteria. */
export function criteriaFromCheckpoints(
  checkpoints: { description: string; marks: number }[],
  maximumMarks: number,
): SchemeCriterion[] {
  const usable = checkpoints.filter((c) => typeof c.description === "string" && c.description.trim());
  if (usable.length === 0) return [];
  const marks = snapToHalfMarks(
    usable.map((c) => Number(c.marks)),
    maximumMarks,
  );
  // A criterion that rounds to nothing is dropped: its share was already redistributed above,
  // and a zero-mark criterion would fail validation.
  return usable
    .map((c, index): SchemeCriterion => ({ id: `c${index + 1}`, kind: "STEP", description: c.description.trim(), marks: marks[index] }))
    .filter((criterion) => criterion.marks > 0);
}

function isCriterion(value: unknown): value is SchemeCriterion {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.kind === "string" &&
    (CRITERION_KINDS as readonly string[]).includes(c.kind) &&
    typeof c.description === "string" &&
    typeof c.marks === "number"
  );
}

export function parseCriteria(raw: unknown): SchemeCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCriterion).map((c) => ({
    id: c.id,
    kind: c.kind,
    description: c.description,
    marks: c.marks,
    ...(typeof c.evidenceHint === "string" ? { evidenceHint: c.evidenceHint } : {}),
    ...(Array.isArray(c.accepted) ? { accepted: c.accepted.filter((a): a is string => typeof a === "string") } : {}),
    ...(typeof c.unit === "string" ? { unit: c.unit } : {}),
  }));
}

export interface VersionLike {
  criteria?: unknown;
  markingCheckpoints?: unknown;
  followThrough?: string | null;
  noWorkingRule?: string | null;
  acceptedAlternatives?: unknown;
}

/** The scheme of a stored rubric version, deriving criteria from older checkpoints when none were stored. */
export function schemeOf(version: VersionLike, maximumMarks: number): Scheme {
  let criteria = parseCriteria(version.criteria);
  if (criteria.length === 0 && Array.isArray(version.markingCheckpoints)) {
    criteria = criteriaFromCheckpoints(
      (version.markingCheckpoints as unknown[]).flatMap((item) =>
        typeof item === "object" && item !== null && typeof (item as { description?: unknown }).description === "string"
          ? [{ description: (item as { description: string }).description, marks: Number((item as { marks?: unknown }).marks) }]
          : [],
      ),
      maximumMarks,
    );
  }

  return {
    criteria,
    followThrough: (FOLLOW_THROUGH_RULES as readonly string[]).includes(version.followThrough ?? "")
      ? (version.followThrough as FollowThrough)
      : DEFAULT_FOLLOW_THROUGH,
    noWorkingRule: (NO_WORKING_RULES as readonly string[]).includes(version.noWorkingRule ?? "")
      ? (version.noWorkingRule as NoWorkingRule)
      : DEFAULT_NO_WORKING_RULE,
    acceptedAlternatives: Array.isArray(version.acceptedAlternatives)
      ? version.acceptedAlternatives.filter((a): a is string => typeof a === "string")
      : [],
  };
}

/** A scheme may be used to mark only after a teacher has approved it (decision D8). */
export function isSchemeApproved(version: { approvedAt?: Date | string | null } | null | undefined): boolean {
  return Boolean(version?.approvedAt);
}
