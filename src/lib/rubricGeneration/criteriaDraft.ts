import {
  CRITERION_KINDS,
  criteriaFromCheckpoints,
  snapToHalfMarks,
  validateCriteria,
  type CriterionKind,
  type SchemeCriterion,
} from "@/lib/scheme/criteria";

/**
 * Turns the criteria a model drafted into a scheme that is safe to store:
 * every criterion a known kind, marks in half-marks, and the total EXACTLY the
 * question's maximum. A model is never trusted with arithmetic — it supplies the
 * relative weight of each criterion and this code decides the marks.
 *
 * Pure, so it is unit-tested without a model.
 */

const MAX_DESCRIPTION = 500;
const MAX_ACCEPTED = 20;
const MAX_ACCEPTED_LENGTH = 120;
const MAX_EXPECTED_KEY_LENGTH = 80;

function isKind(value: unknown): value is CriterionKind {
  return typeof value === "string" && (CRITERION_KINDS as readonly string[]).includes(value);
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, MAX_ACCEPTED_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_ACCEPTED) break;
  }
  return out;
}

/**
 * Returns the validated criteria, or an empty list when the model gave nothing
 * usable (the caller then falls back to the older checkpoint list).
 */
export function buildCriteriaFromDraft(
  rawCriteria: unknown,
  maximumMarks: number,
  expectedAnswer: string,
): SchemeCriterion[] {
  if (!Array.isArray(rawCriteria) || !(maximumMarks > 0)) return [];

  const drafted = rawCriteria
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      kind: isKind(item.kind) ? item.kind : ("STEP" as CriterionKind),
      description: typeof item.description === "string" ? item.description.trim().slice(0, MAX_DESCRIPTION) : "",
      weight: Number(item.marks),
      accepted: cleanList(item.accepted),
      unit: typeof item.unit === "string" ? item.unit.trim().slice(0, 30) : "",
      evidenceHint: typeof item.evidenceHint === "string" ? item.evidenceHint.trim().slice(0, 200) : "",
    }))
    .filter((item) => item.description);

  if (drafted.length === 0) return [];

  const marks = snapToHalfMarks(
    drafted.map((item) => item.weight),
    maximumMarks,
  );

  const criteria: SchemeCriterion[] = [];
  drafted.forEach((item, index) => {
    if (marks[index] <= 0) return;
    let kind = item.kind;
    let accepted = item.accepted;

    if (kind === "EXACT_KEY" && accepted.length === 0) {
      const key = expectedAnswer.trim();
      if (key && key.length <= MAX_EXPECTED_KEY_LENGTH && !key.includes("\n")) accepted = [key];
      // A long expected answer is not something to match exactly; it is judged as a final answer.
      else kind = "FINAL_ANSWER";
    }

    criteria.push({
      id: `c${criteria.length + 1}`,
      kind,
      description: item.description,
      marks: marks[index],
      ...(item.evidenceHint ? { evidenceHint: item.evidenceHint } : {}),
      ...(kind === "EXACT_KEY" ? { accepted } : {}),
      ...(kind === "UNIT" && item.unit ? { unit: item.unit } : {}),
    });
  });

  return validateCriteria(criteria, maximumMarks).ok ? criteria : [];
}

/** Criteria plus the older checkpoint list, from whichever the model produced. */
export function criteriaWithFallback(
  rawCriteria: unknown,
  legacyCheckpoints: { description: string; marks: number }[],
  maximumMarks: number,
  expectedAnswer: string,
): SchemeCriterion[] {
  const fromModel = buildCriteriaFromDraft(rawCriteria, maximumMarks, expectedAnswer);
  if (fromModel.length > 0) return fromModel;
  return criteriaFromCheckpoints(legacyCheckpoints, maximumMarks);
}
