import type { MarkingDetail } from "@/lib/structuredCorrection/scoring";
import type { ComparisonResult, ErrorExplanation } from "@/types/structuredCorrection";

/**
 * A mark and a mistake must not contradict each other (plan issue 37). The mark is decided by the
 * scheme; the findings are suggestions about WHERE work went wrong. A student who earned the marks
 * must never be shown a "mistake" that the marking itself did not count.
 *
 *   - Full marks: nothing is shown.
 *   - The final answer was awarded: no finding about the final answer is shown (a finding is about
 *     the final answer when its comparison error names no variable).
 *   - A "you did not write X" finding is dropped when a scheme item that WAS awarded names X (its
 *     variable, or its expected value as a whole word): the marking accepted that step.
 *
 * Everything else stays: a finding on a step that cost marks is exactly what a teacher needs to see,
 * and every finding is only a suggestion until the teacher keeps it (decision D5).
 *
 * Pure: no model, no database.
 */
export function reconcileFindingsWithMarks(input: {
  explanations: ErrorExplanation[];
  comparison: ComparisonResult;
  marking: MarkingDetail | undefined;
  awardedMarks: number;
  maximumMarks: number;
}): ErrorExplanation[] {
  const { explanations, comparison, marking, awardedMarks, maximumMarks } = input;
  if (explanations.length === 0) return explanations;

  if (awardedMarks >= maximumMarks) return [];

  const awardedText = (marking?.criteria ?? []).filter((c) => c.awarded > 0).map((c) => wordsOf(c.description));
  const acceptedMissing = new Set(
    comparison.errors
      .filter((error) => error.type === "MISSING_STEP" && awardedText.some((words) => mentions(words, error)))
      .map((error) => error.id),
  );
  const remaining = acceptedMissing.size === 0 ? explanations : explanations.filter((e) => !acceptedMissing.has(e.errorId));
  if (remaining.length === 0) return [];

  const finalAnswerAwarded = (marking?.criteria ?? []).some(
    (criterion) => criterion.kind === "FINAL_ANSWER" && criterion.awarded >= criterion.maxMarks,
  );
  if (!finalAnswerAwarded) return remaining;

  const aboutFinalAnswer = new Set(comparison.errors.filter((error) => !error.variable).map((error) => error.id));
  return remaining.filter((explanation) => !aboutFinalAnswer.has(explanation.errorId));
}

/** Lower-case words and numbers of a sentence, with units and degree signs left off numbers ("0°" is the word "0"). */
function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/°/g, " ")
      .split(/[^\p{L}\p{N}.]+/u)
      .map((word) => word.replace(/^\.+|\.+$/g, ""))
      .filter(Boolean),
  );
}

/** Does this scheme item name the quantity a missing-step finding is about: by its variable or by its expected value? */
function mentions(words: Set<string>, error: ComparisonResult["errors"][number]): boolean {
  const variable = error.variable?.toLowerCase().trim();
  if (variable && words.has(variable)) return true;
  const expected = error.expected?.raw ? wordsOf(error.expected.raw) : new Set<string>();
  return [...expected].some((word) => /\d/.test(word) && words.has(word));
}
