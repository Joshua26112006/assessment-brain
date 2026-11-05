import { parseLabel, type ParsedLabel } from "@/lib/questions/labels";

/**
 * Finding where each question starts on a scanned page, from the words the text
 * detector read (decision D4 and plan Phase 3, step 6).
 *
 * A real marker is the FIRST word or two of its own printed line — a number in
 * the middle of a sentence is never one — and markers are searched strictly in
 * paper order, each starting after the previous one's line, so an earlier
 * question's own content can never be taken for a later question's marker.
 *
 * Pure: no text-detection types, no network, so every form is unit-tested.
 */

export interface LineWord {
  text: string;
  /** 0 to 100, as the detector reports it. */
  confidence: number;
}

export interface MarkerLine {
  /** The line's words in order. Only the first three are looked at. */
  words: LineWord[];
}

export interface MarkerTarget {
  questionNumber: number;
  /** What the paper calls it: "3", "3(b)". Null reads as the question number. */
  label?: string | null;
}

/** A marker the detector was unsure of may be a scrawl that happens to look like "(5)". */
export const MIN_MARKER_CONFIDENCE = 70;

interface Candidate {
  label: ParsedLabel;
  confidence: number;
}

function sameParts(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function sameLabel(a: ParsedLabel, b: ParsedLabel): boolean {
  return a.number === b.number && sameParts(a.parts, b.parts);
}

/** The label a line starts with, and how sure the detector was of the words that made it. */
function candidateOf(line: MarkerLine): Candidate | null {
  const words = line.words.slice(0, 3);
  if (words.length === 0) return null;

  const full = parseLabel(words.map((word) => word.text).join(" "));
  if (!full) return null;

  // The fewest words that read as the same label: "Q" "1." is two words, "3(b)" is one.
  for (let count = 1; count <= words.length; count++) {
    const label = parseLabel(words.slice(0, count).map((word) => word.text).join(" "));
    if (label && sameLabel(label, full)) {
      return { label: full, confidence: Math.min(...words.slice(0, count).map((word) => word.confidence)) };
    }
  }
  return { label: full, confidence: Math.min(...words.map((word) => word.confidence)) };
}

/** Whether a line's label stands for the target question. */
function matches(candidate: ParsedLabel, target: ParsedLabel): boolean {
  if (sameLabel(candidate, target)) return true;
  // A part written alone — "(b)", "ii)" — stands for the target when it is the target's own last part(s).
  if (candidate.number === null && candidate.parts.length > 0 && target.parts.length >= candidate.parts.length) {
    return sameParts(candidate.parts, target.parts.slice(-candidate.parts.length));
  }
  return false;
}

/** (a) and (i) start a question; there is no earlier part whose marker could be mistaken for it. */
function startsItsQuestion(parts: string[]): boolean {
  return parts.length > 0 && parts.every((part) => part === "a" || part === "i");
}

/**
 * For each target, the index of the line it starts on. A target with no confident
 * marker is simply absent from the result: at worst a question goes unmarked,
 * rather than being marked in the wrong place.
 */
export function locateMarkers(
  lines: MarkerLine[],
  targets: MarkerTarget[],
  minConfidence: number = MIN_MARKER_CONFIDENCE,
): Map<number, number> {
  const candidates = lines.map(candidateOf);
  const found = new Map<number, number>();
  let searchFrom = 0;

  for (const target of [...targets].sort((a, b) => a.questionNumber - b.questionNumber)) {
    const wanted = parseLabel(target.label?.trim() ? target.label : String(target.questionNumber), { loose: true });
    if (!wanted || wanted.number === null) continue;

    const firstMatch = (accept: (candidate: ParsedLabel) => boolean): number => {
      for (let index = searchFrom; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (!candidate || candidate.confidence < minConfidence) continue;
        if (accept(candidate.label)) return index;
      }
      return -1;
    };

    let index = firstMatch((candidate) => matches(candidate, wanted));

    // 3(a) with no line of its own: the paper often prints "3." and then the part on the next line,
    // so the first part starts on the line that carries the question number.
    if (index === -1 && startsItsQuestion(wanted.parts)) {
      index = firstMatch((candidate) => candidate.number === wanted.number && candidate.parts.length === 0);
    }

    if (index >= 0) {
      found.set(target.questionNumber, index);
      searchFrom = index + 1;
    }
  }
  return found;
}
