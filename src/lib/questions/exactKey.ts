import { parseNumericExpression } from "@/lib/structuredCorrection/numericExpression";

/**
 * Marking an answer that is right or wrong exactly: an option letter (MCQ), one
 * word, a name, a date, a fill-in (decision D4 of 06-correction-hardening-plan.md).
 * Code decides — no model — and anything short of an exact match is a teacher's
 * call, never an automatic "wrong" (decision D15, precision over recall).
 *
 * Pure: no database.
 */

export type ExactKeyVerdict = "MATCH" | "CLOSE" | "MISS" | "EMPTY";

export interface ExactKeyResult {
  verdict: ExactKeyVerdict;
  /** The accepted answer that matched or was close, as the scheme wrote it. */
  matched?: string;
  /** Edit distance to the closest accepted answer, when the verdict is CLOSE or MISS. */
  distance?: number;
  /**
   * True when the key is an option letter or digit, so a different answer is plainly wrong.
   * For a word or name a different answer might be a valid variant the scheme did not list,
   * so a MISS is not definite and the teacher is told to check.
   */
  definite: boolean;
}

const FILLER = /^(?:option|ans(?:wer)?|choice)\s*[:.\-]?\s*/i;

/** Lower-case, no accents, no surrounding punctuation or brackets, "option (b)." read as "b", spaces collapsed. */
export function normalizeAnswer(text: string): string {
  let value = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  value = value.replace(FILLER, "");
  // "(b)", "b)", "b." around a single letter or digit.
  const option = value.match(/^\(?\s*([a-z0-9])\s*[).]?$/);
  if (option) return option[1];
  return value
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/[‘’'"`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function wholeWordContains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function sharesLongWord(a: string, b: string): boolean {
  const words = new Set(a.split(" ").filter((word) => word.length >= 4));
  return b.split(" ").some((word) => word.length >= 4 && words.has(word));
}

function isOptionKey(normalized: string): boolean {
  return /^[a-z0-9]$/.test(normalized);
}

export function matchExactKey(studentAnswer: string, accepted: string[]): ExactKeyResult {
  const student = normalizeAnswer(studentAnswer);
  const keys = accepted
    .map((original) => ({ original, normalized: normalizeAnswer(original) }))
    .filter((key) => key.normalized);

  const definite = keys.length > 0 && keys.every((key) => isOptionKey(key.normalized));
  if (!student) return { verdict: "EMPTY", definite };
  if (keys.length === 0) return { verdict: "MISS", definite: false };

  // Numbers are compared as numbers, from the text as written ("4.0" and "4", "1/2" and "0.5").
  const studentNumber = parseNumericExpression(studentAnswer.trim());
  for (const key of keys) {
    if (student === key.normalized) return { verdict: "MATCH", matched: key.original, definite };
    const keyNumber = parseNumericExpression(key.original.trim());
    if (studentNumber !== null && keyNumber !== null && Math.abs(studentNumber - keyNumber) <= 1e-9) {
      return { verdict: "MATCH", matched: key.original, definite };
    }
  }

  // Close, but not exact: a slip of spelling, or the key inside a longer answer ("it is nehru"),
  // or part of the key ("nehru" for "jawaharlal nehru"). Never decided automatically.
  let closest: { original: string; distance: number } | null = null;
  for (const key of keys) {
    const distance = levenshtein(student, key.normalized);
    // A slip of one or two letters is close; a short word has no slack (cat and cot are different words).
    const allowed = key.normalized.length >= 5 ? 2 : key.normalized.length === 4 ? 1 : 0;
    const contains = wholeWordContains(student, key.normalized) || wholeWordContains(key.normalized, student);
    // One whole word in common ("Gandhi Nehru" for "Jawaharlal Nehru") is worth a teacher's look.
    const shared = sharesLongWord(student, key.normalized);
    if (!isOptionKey(key.normalized) && (distance <= allowed || contains || shared)) {
      if (!closest || distance < closest.distance) closest = { original: key.original, distance };
    }
  }
  if (closest) return { verdict: "CLOSE", matched: closest.original, distance: closest.distance, definite: false };

  const distance = Math.min(...keys.map((key) => levenshtein(student, key.normalized)));
  return { verdict: "MISS", distance, definite };
}
