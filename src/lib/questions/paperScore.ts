import { computeTotals, flatTree, parseTree, validateTree, type LeafResult, type QuestionTree, type Totals } from "@/lib/questions/tree";

/**
 * One place that turns "what each question scored" into "what the paper scored",
 * through the paper's structure (parts, choices, optional groups). Every screen
 * and the marked copy use it, so a total can never differ between them.
 *
 * Pure: no database.
 */

/**
 * Whether the student actually wrote an answer. A question recorded as "not attempted" at
 * confirmation (a 0 with no answer) is not an attempt, so an unchosen alternative never reads
 * as an over attempt just because it was filled in with 0.
 */
export function wasAttempted(studentAnswer: unknown): boolean {
  if (typeof studentAnswer !== "object" || studentAnswer === null) return false;
  const answer = studentAnswer as { text?: unknown; notAttempted?: unknown };
  if (answer.notAttempted === true) return false;
  return typeof answer.text === "string" ? answer.text.trim().length > 0 : true;
}

/**
 * The tree to total with: the paper's stored structure when it is valid for these questions, else a
 * flat list. A broken stored tree must never make a total disappear, so it quietly falls back to
 * the flat sum every paper used before trees existed.
 */
export function effectiveTree(rawTree: unknown, questionIds: string[]): QuestionTree {
  const parsed = parseTree(rawTree);
  if (parsed && validateTree(parsed, questionIds).ok) return parsed;
  return flatTree(questionIds);
}

export interface PaperAnswer {
  questionId: string;
  maximumMarks: number;
  /** Null until the answer has a mark. */
  awardedMarks: number | null;
  attempted: boolean;
}

export function paperTotals(rawTree: unknown, answers: PaperAnswer[]): Totals {
  const tree = effectiveTree(
    rawTree,
    answers.map((answer) => answer.questionId),
  );
  const leaves = new Map<string, LeafResult>(
    answers.map((answer) => [
      answer.questionId,
      { maximumMarks: answer.maximumMarks, awardedMarks: answer.awardedMarks, attempted: answer.attempted },
    ]),
  );
  return computeTotals(tree, leaves);
}
