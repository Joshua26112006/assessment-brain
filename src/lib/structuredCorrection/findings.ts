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

  const finalAnswerAwarded = (marking?.criteria ?? []).some(
    (criterion) => criterion.kind === "FINAL_ANSWER" && criterion.awarded >= criterion.maxMarks,
  );
  if (!finalAnswerAwarded) return explanations;

  const aboutFinalAnswer = new Set(comparison.errors.filter((error) => !error.variable).map((error) => error.id));
  return explanations.filter((explanation) => !aboutFinalAnswer.has(explanation.errorId));
}
