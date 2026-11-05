/**
 * What the marked copy could and could not place on the student's pages, so the teacher is TOLD instead of a
 * mark or a ring silently going missing (or, as it once did, being drawn in a guessed place on top of other
 * marks). Pure: no image, no text detection.
 */

export interface PlacementOutcome {
  /** Questions whose own marker was found on this page, and whose mark was drawn beside it. */
  placedQuestions: number[];
  /** Findings (by question number and error id) that were circled on this page. */
  circled: Array<{ questionNumber: number; errorId: string }>;
}

export interface PlacementQuestion {
  questionNumber: number;
  label?: string | null;
  /** Pages the answer was written on. Empty when unknown: then nothing can be said about where it should appear. */
  sourcePages: number[];
  /** The findings the teacher kept for this answer, each with the student's wrong text to circle (none for a missing step). */
  explanations: Array<{ errorId: string; wrongText?: string }>;
}

export interface PlacementSummary {
  /** Questions that were written on the pages but whose marker could not be found on any of them. */
  unplacedQuestions: string[];
  /** Kept findings whose wrong text could not be circled (not found, or found more than once). */
  unplacedFindings: Array<{ question: string; count: number }>;
}

const nameOf = (question: PlacementQuestion) => question.label?.trim() || String(question.questionNumber);

export function summarizePlacement(questions: PlacementQuestion[], outcomes: PlacementOutcome[]): PlacementSummary {
  const placed = new Set(outcomes.flatMap((outcome) => outcome.placedQuestions));
  const circled = new Set(outcomes.flatMap((outcome) => outcome.circled.map((c) => `${c.questionNumber}:${c.errorId}`)));

  const unplacedQuestions = questions
    .filter((question) => question.sourcePages.length > 0 && !placed.has(question.questionNumber))
    .map(nameOf);

  const unplacedFindings: Array<{ question: string; count: number }> = [];
  for (const question of questions) {
    // A finding can only be circled on a question whose marker was found.
    const count = question.explanations.filter(
      (explanation) => !!explanation.wrongText && !circled.has(`${question.questionNumber}:${explanation.errorId}`),
    ).length;
    if (count > 0 && placed.has(question.questionNumber)) unplacedFindings.push({ question: nameOf(question), count });
  }
  return { unplacedQuestions, unplacedFindings };
}

/** The sentences shown to the teacher after release, or none when everything was placed. */
export function describePlacement(summary: PlacementSummary): string[] {
  const notes: string[] = [];
  if (summary.unplacedQuestions.length > 0) {
    const names = summary.unplacedQuestions.join(", ");
    notes.push(
      `The marks for question${summary.unplacedQuestions.length === 1 ? "" : "s"} ${names} could not be placed on the student's pages (the question number could not be found), so ${summary.unplacedQuestions.length === 1 ? "it is" : "they are"} not drawn there. The marks are still in the total and in the student's results.`,
    );
  }
  for (const finding of summary.unplacedFindings) {
    notes.push(
      `${finding.count} mistake${finding.count === 1 ? "" : "s"} you kept on question ${finding.question} could not be circled (the wrong value was not found on the page, or appears more than once). ${finding.count === 1 ? "It is" : "They are"} still in your notes.`,
    );
  }
  return notes;
}
