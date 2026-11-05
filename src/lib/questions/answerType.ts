import type { SchemeCriterion } from "@/lib/scheme/criteria";

/**
 * How a question is marked (decision D4 of 06-correction-hardening-plan.md). The type
 * a teacher confirmed always wins; otherwise it is worked out from the scheme, so a
 * question created before types existed still routes sensibly.
 *
 * Pure: no database.
 */

export type AnswerType = "NUMERIC" | "SHORT_TEXT" | "DESCRIPTIVE" | "ESSAY" | "EXACT_KEY" | "DIAGRAM";

export interface AnswerTypeInput {
  /** Set by the teacher, or suggested at extraction. Null means "not decided". */
  answerType?: string | null;
  criteria: SchemeCriterion[];
  /** The rubric judged this question to have one definite numeric answer. */
  numericSolvable: boolean;
}

const ALL: readonly string[] = ["NUMERIC", "SHORT_TEXT", "DESCRIPTIVE", "ESSAY", "EXACT_KEY", "DIAGRAM"];

export function answerTypeOf(input: AnswerTypeInput): AnswerType {
  if (input.answerType && ALL.includes(input.answerType)) return input.answerType as AnswerType;

  const kinds = input.criteria.map((c) => c.kind);
  if (kinds.length > 0 && kinds.every((kind) => kind === "EXACT_KEY")) return "EXACT_KEY";
  if (kinds.includes("LEVEL")) return "ESSAY";
  if (input.numericSolvable) return "NUMERIC";
  return "DESCRIPTIVE";
}

/**
 * The accepted answers of a question marked by exact match, or null when it is not marked that
 * way: it needs exactly one exact-answer criterion, so code can decide the whole mark.
 */
export function exactKeyOf(criteria: SchemeCriterion[]): { accepted: string[]; marks: number } | null {
  if (criteria.length !== 1 || criteria[0].kind !== "EXACT_KEY") return null;
  const accepted = (criteria[0].accepted ?? []).map((a) => a.trim()).filter(Boolean);
  return accepted.length > 0 ? { accepted, marks: criteria[0].marks } : null;
}
