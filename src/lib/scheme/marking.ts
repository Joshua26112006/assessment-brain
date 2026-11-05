import {
  METHOD_KINDS,
  isHalfMarkMultiple,
  type FollowThrough,
  type NoWorkingRule,
  type SchemeCriterion,
} from "@/lib/scheme/criteria";

/**
 * How criterion results become a mark. The mark is ALWAYS the sum of the
 * criteria (decision D9); a model never supplies a total. Follow-through (D10)
 * and the no-working rule (D6) are applied here, in code, from what the
 * scheme states — never decided by the AI.
 */

export type CriterionMet = "yes" | "no" | "partial";

export interface CriterionOutcome {
  criterionId: string;
  met: CriterionMet;
  /** True when this criterion was earned only by using an earlier wrong value. */
  usesEarlierError?: boolean;
  /** A short quote or pointer from the transcription that supports the result. */
  evidence?: string;
}

export interface MarkingRules {
  followThrough: FollowThrough;
  noWorkingRule: NoWorkingRule;
  /** Null when the final answer could not be judged (not numeric, or unreadable). */
  finalAnswerCorrect: boolean | null;
  /** False when the student wrote the answer with no working at all. */
  hasWorking: boolean;
}

export type MarkingFlag =
  | "NO_WORKING"
  | "FINAL_ANSWER_CORRECT_NOT_FULL"
  | "FOLLOW_THROUGH_APPLIED"
  | "PARTIAL_NOT_ALLOWED"
  | "UNKNOWN_CRITERION";

export interface CriterionAward {
  criterionId: string;
  maxMarks: number;
  awarded: number;
  /** Plain-language reason when a rule changed what the outcome alone would have earned. */
  note?: string;
}

export interface MarkingResult {
  marks: number;
  maxMarks: number;
  awards: CriterionAward[];
  flags: MarkingFlag[];
}

/** Half of a criterion, in whole half-marks, rounded down: 1 → 0.5, 1.5 → 0.5, 2 → 1, 0.5 → 0 (not splittable). */
export function partialMarks(marks: number): number {
  return Math.floor(marks / 2 / 0.5) * 0.5;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeMarks(
  criteria: SchemeCriterion[],
  outcomes: CriterionOutcome[],
  rules: MarkingRules,
): MarkingResult {
  const byId = new Map(outcomes.map((outcome) => [outcome.criterionId, outcome]));
  const flags = new Set<MarkingFlag>();
  const awards: CriterionAward[] = [];

  const noWorking = rules.finalAnswerCorrect === true && !rules.hasWorking;
  if (noWorking) flags.add("NO_WORKING");

  for (const criterion of criteria) {
    const outcome = byId.get(criterion.id);
    let awarded = 0;
    let note: string | undefined;

    if (!outcome) {
      // Nothing was said about this criterion: it earns nothing, and the teacher is told.
      flags.add("UNKNOWN_CRITERION");
      note = "No result was produced for this criterion.";
    } else if (outcome.met === "yes") {
      awarded = criterion.marks;
    } else if (outcome.met === "partial") {
      const half = partialMarks(criterion.marks);
      if (half === 0) {
        flags.add("PARTIAL_NOT_ALLOWED");
        note = "This criterion is worth too little to split, so partial credit was not given.";
      } else {
        awarded = half;
      }
    }

    // D6 — a correct answer with no working earns only the answer's own marks.
    if (noWorking && METHOD_KINDS.includes(criterion.kind)) {
      if (rules.noWorkingRule === "FINAL_ANSWER_ONLY") {
        if (awarded !== 0) note = "Correct answer with no working: method marks are not given.";
        awarded = 0;
      } else {
        awarded = criterion.marks;
        note = "Correct answer with no working: full marks, because this question's scheme allows it.";
      }
    }

    // D10 — a criterion earned only by carrying an earlier error forward.
    if (outcome?.usesEarlierError && awarded > 0) {
      const isMethod = METHOD_KINDS.includes(criterion.kind);
      const keep = rules.followThrough === "ALLOWED" || (rules.followThrough === "METHOD_ONLY" && isMethod);
      flags.add("FOLLOW_THROUGH_APPLIED");
      if (!keep) {
        awarded = 0;
        note = "Earned only by carrying an earlier error forward, which this question's scheme does not allow.";
      }
    }

    // Every awarded mark is a multiple of half a mark (D12).
    if (!isHalfMarkMultiple(awarded)) awarded = Math.floor(awarded / 0.5) * 0.5;

    awards.push({ criterionId: criterion.id, maxMarks: criterion.marks, awarded, ...(note ? { note } : {}) });
  }

  const maxMarks = round2(criteria.reduce((sum, c) => sum + c.marks, 0));
  const marks = round2(awards.reduce((sum, a) => sum + a.awarded, 0));

  // A correct final answer that did not earn full marks is worth a second look (plan, Phase 4 flag b).
  if (rules.finalAnswerCorrect === true && marks < maxMarks) flags.add("FINAL_ANSWER_CORRECT_NOT_FULL");

  return { marks, maxMarks, awards, flags: [...flags] };
}
