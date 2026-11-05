import type { SchemeCriterion } from "@/lib/scheme/criteria";
import type { CriterionAward, CriterionOutcome, MarkingFlag } from "@/lib/scheme/marking";

/**
 * The pure parts of marking by criteria (decision D2 of 06-correction-hardening-plan.md): reading what
 * a marking run said about each criterion, taking the median of several runs, deciding when they
 * disagree, and explaining in plain words why a teacher should look. No model, no database.
 */

const MAX_EVIDENCE = 240;
const MAX_FEEDBACK = 800;

/** Runs differ by more than this many marks, or by more than this share of the question, and a teacher decides. */
export const SPREAD_MARKS = 1;
export const SPREAD_SHARE = 0.25;

function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toMet(value: unknown): CriterionOutcome["met"] | null {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "yes" || text === "true" || text === "met") return "yes";
  if (text === "no" || text === "false" || text === "not met") return "no";
  if (text === "partial" || text === "partially") return "partial";
  return null;
}

export interface ParsedReply {
  outcomes: CriterionOutcome[];
  /** Asked-about criteria the reply did not answer, or answered with something that is not yes, no or partial. */
  missing: string[];
  /** Criteria passed as met whose quoted evidence is not in the transcription (or is empty). */
  evidenceNotFound: string[];
  feedback: string;
}

/**
 * What one run said. Only criteria that were asked about are accepted; anything the model volunteered
 * about another criterion is ignored. A criterion it did not answer is reported as missing, never
 * assumed "no" or "yes".
 */
export function parseCriterionReply(raw: unknown, askedIds: string[], transcription: string): ParsedReply {
  const reply = typeof raw === "object" && raw !== null ? (raw as { criteria?: unknown; feedback?: unknown }) : {};
  const list = Array.isArray(reply.criteria) ? reply.criteria : [];
  const asked = new Set(askedIds);
  const transcript = foldForSearch(transcription);

  const outcomes = new Map<string, CriterionOutcome>();
  const evidenceNotFound: string[] = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as { id?: unknown; met?: unknown; usesEarlierError?: unknown; evidence?: unknown };
    if (typeof entry.id !== "string" || !asked.has(entry.id) || outcomes.has(entry.id)) continue;
    const met = toMet(entry.met);
    if (met === null) continue;
    const evidence = typeof entry.evidence === "string" ? entry.evidence.trim().slice(0, MAX_EVIDENCE) : "";
    outcomes.set(entry.id, {
      criterionId: entry.id,
      met,
      ...(entry.usesEarlierError === true ? { usesEarlierError: true } : {}),
      ...(evidence ? { evidence } : {}),
    });
    // Credit needs a quote the transcription really contains; a claim with no support is worth a second look.
    if (met !== "no" && (!evidence || !transcript.includes(foldForSearch(evidence)))) evidenceNotFound.push(entry.id);
  }

  return {
    outcomes: [...outcomes.values()],
    missing: askedIds.filter((id) => !outcomes.has(id)),
    evidenceNotFound,
    feedback: typeof reply.feedback === "string" ? reply.feedback.trim().slice(0, MAX_FEEDBACK) : "",
  };
}

/** The middle total. With an even number of runs (one failed) the LOWER of the middle two: caution, and it is flagged anyway. */
export function medianOf(values: number[]): number {
  if (values.length === 0) throw new Error("There are no values to take a median of.");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function spreadOf(totals: number[]): number {
  return Math.round((Math.max(...totals) - Math.min(...totals)) * 100) / 100;
}

/** Whether the runs disagree enough that a teacher should decide. */
export function runsDisagree(totals: number[], maximumMarks: number): boolean {
  if (totals.length < 2) return false;
  const spread = spreadOf(totals);
  return spread > SPREAD_MARKS || spread > SPREAD_SHARE * maximumMarks;
}

export interface MarkingReasonInput {
  totals: number[];
  maximumMarks: number;
  runsAttempted: number;
  flags: MarkingFlag[];
  readingConfident: boolean;
  evidenceNotFoundCount: number;
  undecidedFinalAnswer: boolean;
}

/** Plain-language reasons a teacher should check this answer, most important first. Empty when the marking is steady. */
export function markingReasons(input: MarkingReasonInput): string[] {
  const reasons: string[] = [];
  if (runsDisagree(input.totals, input.maximumMarks)) {
    reasons.push(
      `The marking checks disagreed: the same answer scored from ${Math.min(...input.totals)} to ${Math.max(...input.totals)} out of ${input.maximumMarks}.`,
    );
  }
  if (input.totals.length < input.runsAttempted) {
    reasons.push(`Only ${input.totals.length} of ${input.runsAttempted} marking checks completed.`);
  }
  if (input.flags.includes("NO_WORKING")) {
    reasons.push("The final answer is correct but no working was shown, so only the answer's marks were given.");
  }
  if (input.flags.includes("FINAL_ANSWER_CORRECT_NOT_FULL") && !input.flags.includes("NO_WORKING")) {
    reasons.push("The final answer is correct but full marks were not given. Check why.");
  }
  if (input.flags.includes("UNKNOWN_CRITERION")) {
    reasons.push("The marking did not give a result for every part of the marking scheme.");
  }
  if (input.flags.includes("PARTIAL_NOT_ALLOWED")) {
    reasons.push("Part of the scheme is worth too little to give partial credit for.");
  }
  if (input.evidenceNotFoundCount > 0) {
    reasons.push("Some credit was given without a matching line in the transcription.");
  }
  if (!input.readingConfident) {
    reasons.push("The handwriting was hard to read, so the transcription may be wrong.");
  }
  if (input.undecidedFinalAnswer) {
    reasons.push("The final answer could not be checked automatically against the key.");
  }
  return reasons;
}

/** What each criterion earned, with its description, for the teacher's explanation of the mark. */
export function describeAwards(criteria: SchemeCriterion[], awards: CriterionAward[], outcomes: CriterionOutcome[]) {
  const outcomeById = new Map(outcomes.map((outcome) => [outcome.criterionId, outcome]));
  const awardById = new Map(awards.map((award) => [award.criterionId, award]));
  return criteria.map((criterion) => {
    const award = awardById.get(criterion.id);
    const outcome = outcomeById.get(criterion.id);
    return {
      id: criterion.id,
      kind: criterion.kind,
      description: criterion.description,
      maxMarks: criterion.marks,
      awarded: award?.awarded ?? 0,
      ...(outcome?.evidence ? { evidence: outcome.evidence } : {}),
      ...(award?.note ? { note: award.note } : {}),
    };
  });
}
