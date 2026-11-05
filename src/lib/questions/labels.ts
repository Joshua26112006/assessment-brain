/**
 * Question labels: what a paper calls a question and what a student writes
 * beside their answer — "3", "3(b)", "3(b)(ii)", "Q.3 (b)", "Ans 3b".
 *
 * Pure: no database, no framework. Used to name questions in prompts, to
 * recognise a student's question number on a scanned page, and to match what a
 * model reports back to a question.
 */

export interface ParsedLabel {
  /** The top-level question number, or null for a part written alone: "(b)", "ii)". */
  number: number | null;
  /** Sub-part names in order, lower-case: ["b", "ii"]. */
  parts: string[];
}

/** What the paper calls a question: its label, or its number for one created before labels existed. */
export function labelOf(question: { label?: string | null; questionNumber: number }): string {
  const label = question.label?.trim();
  return label ? label : String(question.questionNumber);
}

/**
 * How a question is listed to a reading model. An ordinary question is listed exactly as it always was
 * ("Question 4: text"). A part such as 2(a) is listed under the name a student writes, with the number the
 * model must answer with, because every stage identifies a question by its number.
 */
export function questionPromptLine(question: { label?: string | null; questionNumber: number; questionText: string }): string {
  const label = labelOf(question);
  if (label === String(question.questionNumber)) return `- Question ${question.questionNumber}: ${question.questionText}`;
  return `- Question ${label} (refer to it by the number ${question.questionNumber}): ${question.questionText}`;
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const LETTER_PARTS = "abcdefgh";

const PREFIX = /^(?:question|ques|qn|q|ans(?:wer)?)\s*[.:\-]?\s*/i;

function isRoman(token: string): boolean {
  return ROMAN.includes(token);
}

/** One bracketed part: "(b)", "(ii)", "b)", "ii)". Returns the part name and the characters it used. */
function readBracketedPart(text: string): { part: string; length: number } | null {
  const match = text.match(/^\s*(?:\(\s*([a-z]{1,4})\s*\)|([a-z]{1,4})\s*\))/i);
  if (!match) return null;
  const part = (match[1] ?? match[2]).toLowerCase();
  if (part.length === 1 || isRoman(part)) return { part, length: match[0].length };
  return null;
}

/**
 * Reads a question label from the START of a piece of text. Anything after the
 * label is ignored, so a whole line can be passed in. Returns null when the text
 * does not begin with a label.
 *
 * Accepted: "3", "3.", "3)", "(3)", "Q3", "Q.3", "Q 3", "Q3.", "Q3:", "Question 3",
 * "Ans 3", "Ans. 3", "3(b)", "3 (b)", "3(b)(ii)", "3b", "3.b", "3-b", and a part
 * written alone: "(b)", "b)", "(ii)", "ii)". A bare letter after a number is
 * accepted only for a–h, so "3x + 2 = 5" is an equation, not question 3(x).
 */
export function parseLabel(text: string, options: { loose?: boolean } = {}): ParsedLabel | null {
  let rest = text.trim().replace(/^[\s•\-–—*]+/, "");
  if (!rest) return null;

  const hadPrefix = PREFIX.test(rest);
  if (hadPrefix) rest = rest.replace(PREFIX, "");

  // A part written alone, with no question number: "(b)", "b)", "(ii)".
  const alone = readBracketedPart(rest);
  if (!hadPrefix && alone) {
    const parts = [alone.part];
    let remainder = rest.slice(alone.length);
    for (let next = readBracketedPart(remainder); next; next = readBracketedPart(remainder)) {
      parts.push(next.part);
      remainder = remainder.slice(next.length);
    }
    return endsCleanly(remainder) ? { number: null, parts } : null;
  }

  // The number, optionally wrapped: "3", "(3)", "3.", "3)".
  const numberMatch = rest.match(/^\(?\s*(\d{1,3})(?:\s*\))?/);
  if (!numberMatch) return null;
  const number = Number(numberMatch[1]);
  let remainder = rest.slice(numberMatch[0].length);

  // "3. (a)" and "3: (a)": the punctuation sits between the number and a bracketed part.
  remainder = remainder.replace(/^[.:]\s*(?=\()/, "");

  // A "." or ":" straight after the number is punctuation, unless a part follows it ("3.b").
  const parts: string[] = [];
  // Loose reading (matching a label somebody WROTE, not recognising the start of a scanned line) also
  // accepts a bare letter after a space: "3 b".
  const glued = remainder.match(options.loose ? /^(?:[.\-]|\s+)?([a-h])(?![a-z])/i : /^[.\-]?([a-h])(?![a-z])/i);
  if (glued && (options.loose ? /^(?:[.\-]|\s+)?[a-h](?:\s|\(|\)|\.|$)/i : /^[.\-]?[a-h](?:\s|\(|\)|\.|$)/i).test(remainder)) {
    parts.push(glued[1].toLowerCase());
    remainder = remainder.slice(glued[0].length);
  }
  for (let next = readBracketedPart(remainder); next; next = readBracketedPart(remainder)) {
    parts.push(next.part);
    remainder = remainder.slice(next.length);
  }

  return endsCleanly(remainder) ? { number, parts } : null;
}

/**
 * A label ends where the label ends, not in the middle of something else. "3x + 2 = 5",
 * "3.5 m", "3/4", "3-4", "3 + 2" and "3²" all START with a 3 but are working, not question 3.
 */
function endsCleanly(remainder: string): boolean {
  if (remainder === "") return true;
  if (/^[A-Za-z0-9]/.test(remainder)) return false;
  if (/^[.,]\d/.test(remainder)) return false;
  if (/^\s*[\/\-–]\s*\d/.test(remainder)) return false;
  if (/^\s*[+*×÷=<>^²³]/.test(remainder)) return false;
  return true;
}

/** A canonical form for comparing labels: "3(b)(ii)", or "(b)" for a part alone, or null if there is no label. */
export function normalizeLabel(text: string): string | null {
  // Loose: this compares labels somebody wrote, so "3 b" and "3(b)" are the same question.
  const parsed = parseLabel(text, { loose: true });
  if (!parsed) return null;
  const suffix = parsed.parts.map((part) => `(${part})`).join("");
  return parsed.number === null ? suffix : `${parsed.number}${suffix}`;
}

/** Whether two labels name the same question, ignoring prefixes, case, spacing and bracket style. */
export function labelsMatch(a: string, b: string): boolean {
  const left = normalizeLabel(a);
  const right = normalizeLabel(b);
  return left !== null && left === right;
}

/** Finds the question whose label a model (or student) wrote, among a paper's questions. */
export function findQuestionByLabel<T extends { label?: string | null; questionNumber: number }>(
  written: string,
  questions: T[],
): T | null {
  const target = normalizeLabel(written);
  if (!target) return null;
  return questions.find((question) => normalizeLabel(labelOf(question)) === target) ?? null;
}

export { LETTER_PARTS };
