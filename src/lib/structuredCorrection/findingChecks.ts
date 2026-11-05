import type { ComparisonResult } from "@/types/structuredCorrection";

/**
 * The student's own side of a finding (Phase 6 of 06-correction-hardening-plan.md, decision D15: precision
 * over recall). A finding tells a student "you wrote X" and "it should be Y". Before it is shown, both halves
 * are checked in code:
 *
 *   - the value it says the student wrote must really be in what was read from their page;
 *   - the sentence that explains it may only use numbers the finding itself contains.
 *
 * Telling a student they wrote something they did not is the worst kind of error, so a finding that fails
 * either check is dropped or reworded, never shown as it was.
 *
 * Pure: no model, no database.
 */

function foldText(text: string): string {
  return text.toLowerCase().replace(/[‘’'"`]/g, "").replace(/\s+/g, " ").trim();
}

/** Every number written in a piece of text, as numbers: "20 x 10 = 200" gives 20, 10, 200; "1/2" also gives 0.5. */
function numbersIn(text: string): number[] {
  const numbers: number[] = [];
  for (const literal of text.match(/\d+(?:\.\d+)?/g) ?? []) numbers.push(Number(literal));
  for (const fraction of text.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)) {
    const denominator = Number(fraction[2]);
    if (denominator !== 0) numbers.push(Number(fraction[1]) / denominator);
  }
  return numbers;
}

/**
 * Whether the value a finding says the student wrote is really in what was read from the page. A finding with
 * nothing quoted (a missing step) has nothing to check here.
 */
export function studentValueIsInTranscription(
  error: { actual?: { raw: string; parsed: number | null } },
  transcription: string,
): boolean {
  const actual = error.actual;
  if (!actual || !actual.raw.trim()) return true;

  if (foldText(transcription).includes(foldText(actual.raw))) return true;
  // Written differently from how it was extracted ("2 x 10 x 5 = 120 J" and a value of 120): the number itself is there.
  if (actual.parsed !== null) {
    const target = actual.parsed;
    const tolerance = Math.max(1e-9, Math.abs(target) * 1e-9);
    return numbersIn(transcription).some((value) => Math.abs(value - target) <= tolerance);
  }
  return false;
}

/**
 * The comparison without any finding whose quoted student value is not in the transcription, and without any
 * finding that only existed as a consequence of one that was dropped.
 */
export function withoutUnsupportedErrors(comparison: ComparisonResult, transcription: string): ComparisonResult {
  if (comparison.errors.length === 0) return comparison;

  const dropped = new Set(
    comparison.errors.filter((error) => !studentValueIsInTranscription(error, transcription)).map((error) => error.id),
  );
  if (dropped.size === 0) return comparison;

  let changed = true;
  while (changed) {
    changed = false;
    for (const error of comparison.errors) {
      if (!dropped.has(error.id) && error.dependsOn.some((id) => dropped.has(id))) {
        dropped.add(error.id);
        changed = true;
      }
    }
  }
  return { ...comparison, errors: comparison.errors.filter((error) => !dropped.has(error.id)) };
}

/**
 * Whether the numbers in a sentence about a finding are all numbers the finding itself contains: the key's value
 * and the student's. A sentence that brings in any other number was not written from the finding (the wording
 * model drifted), so the plain deterministic wording is used instead.
 */
export function explanationAgreesWithFinding(
  text: string,
  error: { variable?: string; expected?: { raw: string; parsed: number | null }; actual?: { raw: string; parsed: number | null } },
): boolean {
  const allowed: number[] = [];
  for (const value of [error.expected, error.actual]) {
    if (!value) continue;
    allowed.push(...numbersIn(value.raw));
    if (value.parsed !== null) allowed.push(value.parsed);
  }
  // Digits inside the quantity's own name ("f1", "R_2") are part of the name, not a number.
  for (const digit of error.variable?.match(/\d+/g) ?? []) allowed.push(Number(digit));

  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);
  // Rounded forms of an allowed value are fine too ("2.449" may be written "2.45" or "2.4").
  const matchesAllowed = (value: number) =>
    allowed.some(
      (candidate) =>
        near(value, candidate) || [0, 1, 2, 3].some((places) => near(value, Math.round(candidate * 10 ** places) / 10 ** places)),
    );

  // Digits that belong to the sentence's own wording ("step 1", "line 2") are not claims about the finding.
  const cleaned = text.replace(/\b(?:step|line|part|question|mark|marks|page)\s*\d+\b/gi, "");
  return numbersIn(cleaned).every(matchesAllowed);
}
