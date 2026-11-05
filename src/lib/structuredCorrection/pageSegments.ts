import { parseStructuredValue } from "@/lib/structuredCorrection/numericExpression";
import {
  PROBLEM_TYPES,
  type ExtractedValue,
  type ProblemType,
  type ReadingSegment,
  type ReconcileConfidence,
} from "@/types/structuredCorrection";

/**
 * Reading a long paper page by page (Phase 5 of 06-correction-hardening-plan.md).
 *
 * Reading the whole paper in one call capped the answer length and the paper length: one 8000-token
 * reply had to hold every transcription, and a 3-page essay or a 24-page booklet simply did not fit.
 * Here each page is read on its own, the pieces of one answer that run across pages are stitched
 * together by question, and what the student CROSSED OUT or wrote as ROUGH WORK is kept with a status
 * and handled by fixed rules (Cambridge and Edexcel practice):
 *
 *   struck and replaced   -> not marked (shown greyed to the teacher)
 *   struck, not replaced  -> marked: it is all the student gave
 *   rough work            -> never marked (shown greyed)
 *   two live attempts     -> a teacher decides
 *
 * Pure: no model, no database.
 */

export type SegmentStatus = "active" | "struck" | "rough";

export interface PageSegment {
  questionNumber: number;
  status: SegmentStatus;
  /** Only for a struck segment: the student wrote a replacement for it. */
  replaced: boolean;
  text: string;
  steps: string[];
  variables: Record<string, ExtractedValue>;
  studentAnswer: ExtractedValue | null;
  containsDiagram: boolean;
  /** The language of the WORDS, "English", "Hindi", ...; "none" for numbers and symbols only. */
  language: string;
  /** Two different un-struck attempts at the same answer appear on this page. */
  twoAttempts: boolean;
  structureConfidence: ReconcileConfidence;
  problemType: ProblemType;
}

/** One question as a single reading pass saw it across ALL pages, ready for reconciliation. */
export interface StitchedReading {
  questionNumber: number;
  attempted: boolean;
  /** What is marked: live text and struck text that was never replaced, in page order. */
  transcription: string;
  problemType: ProblemType;
  steps: string[];
  variables: Record<string, ExtractedValue>;
  studentAnswer: ExtractedValue | null;
  structureConfidence: ReconcileConfidence;
  /** Everything read for this question with its status, for the teacher's view. */
  segments: ReadingSegment[];
  containsDiagram: boolean;
  languages: string[];
  conflictingAttempts: boolean;
}

const MAX_TEXT = 4000;
const MAX_STEPS = 30;
const MAX_STEP_LENGTH = 500;
const MAX_VARIABLES = 40;
const MAX_VALUE_LENGTH = 200;
const MAX_LANGUAGE_LENGTH = 40;

const CONFIDENCE_RANK: Record<ReconcileConfidence, number> = { high: 2, medium: 1, low: 0 };

function trimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function extracted(value: unknown): ExtractedValue {
  const raw = trimmed(value, MAX_VALUE_LENGTH);
  // One number, or an answer with several values (a set, an interval, an ordered pair), kept in that shape.
  return { raw, ...parseStructuredValue(raw) };
}

function confidence(value: unknown): ReconcileConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function problemType(value: unknown): ProblemType {
  return typeof value === "string" && (PROBLEM_TYPES as readonly string[]).includes(value) ? (value as ProblemType) : "unknown";
}

function status(value: unknown): SegmentStatus {
  return value === "struck" || value === "rough" ? value : "active";
}

/**
 * The segments one page's reply described. Only questions on this assessment are accepted; a segment with
 * no text is dropped. A segment the model did not label struck or rough is live: it is MARKED, so only
 * an explicit "struck" or "rough" ever removes work from the marking.
 */
export function parsePageResponse(raw: unknown, validQuestionNumbers: Set<number>): PageSegment[] {
  const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { segments?: unknown }).segments)
    ? ((raw as { segments: unknown[] }).segments)
    : [];
  const out: PageSegment[] = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const questionNumber = typeof entry.questionNumber === "number" ? entry.questionNumber : null;
    if (questionNumber === null || !validQuestionNumbers.has(questionNumber)) continue;

    const text = trimmed(entry.transcription, MAX_TEXT);
    if (!text) continue;

    const variables: Record<string, ExtractedValue> = {};
    if (entry.variables && typeof entry.variables === "object" && !Array.isArray(entry.variables)) {
      for (const [name, value] of Object.entries(entry.variables as Record<string, unknown>).slice(0, MAX_VARIABLES)) {
        const key = name.trim();
        const parsed = extracted(value);
        if (key && parsed.raw) variables[key] = parsed;
      }
    }

    const studentAnswer = extracted(entry.studentAnswer);
    out.push({
      questionNumber,
      status: status(entry.status),
      replaced: entry.replaced === true,
      text,
      steps: Array.isArray(entry.steps)
        ? entry.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, MAX_STEPS).map((s) => s.trim().slice(0, MAX_STEP_LENGTH))
        : [],
      variables,
      studentAnswer: studentAnswer.raw ? studentAnswer : null,
      containsDiagram: entry.containsDiagram === true,
      language: trimmed(entry.language, MAX_LANGUAGE_LENGTH) || "English",
      twoAttempts: entry.twoAttempts === true,
      structureConfidence: confidence(entry.structureConfidence),
      problemType: problemType(entry.problemType),
    });
  }
  return out;
}

/** Whether a segment's text is part of what is marked. */
export function isMarked(segment: Pick<PageSegment, "status" | "replaced">): boolean {
  if (segment.status === "active") return true;
  if (segment.status === "struck") return !segment.replaced;
  return false;
}

/**
 * Joins one pass's segments from every page, in page order, into one reading per question. A question with
 * no segment at all is absent from the result (it was not answered anywhere on the pages).
 */
export function stitchPass(pages: PageSegment[][], validQuestionNumbers: Set<number>): Map<number, StitchedReading> {
  const byQuestion = new Map<number, Array<{ segment: PageSegment; page: number }>>();
  pages.forEach((segments, pageIndex) => {
    for (const segment of segments) {
      if (!validQuestionNumbers.has(segment.questionNumber)) continue;
      const list = byQuestion.get(segment.questionNumber) ?? [];
      list.push({ segment, page: pageIndex + 1 });
      byQuestion.set(segment.questionNumber, list);
    }
  });

  const result = new Map<number, StitchedReading>();
  for (const [questionNumber, entries] of byQuestion) {
    const marked = entries.filter(({ segment }) => isMarked(segment));
    const variables: Record<string, ExtractedValue> = {};
    for (const { segment } of marked) Object.assign(variables, segment.variables);

    const lastWithAnswer = [...marked].reverse().find(({ segment }) => segment.studentAnswer !== null);
    const languages = [...new Set(entries.map(({ segment }) => segment.language.trim()).filter((language) => language && language.toLowerCase() !== "none"))];
    const lowest = marked.reduce<ReconcileConfidence>(
      (low, { segment }) => (CONFIDENCE_RANK[segment.structureConfidence] < CONFIDENCE_RANK[low] ? segment.structureConfidence : low),
      "high",
    );

    result.set(questionNumber, {
      questionNumber,
      attempted: marked.length > 0,
      transcription: marked.map(({ segment }) => segment.text).join("\n").slice(0, MAX_TEXT * 8),
      problemType: marked.find(({ segment }) => segment.problemType !== "unknown")?.segment.problemType ?? "unknown",
      steps: marked.flatMap(({ segment }) => segment.steps).slice(0, MAX_STEPS),
      variables,
      studentAnswer: lastWithAnswer?.segment.studentAnswer ?? null,
      structureConfidence: marked.length > 0 ? lowest : "low",
      segments: entries.map(({ segment, page }) => ({
        page,
        status: segment.status === "struck" && segment.replaced ? "struck" : segment.status,
        marked: isMarked(segment),
        text: segment.text,
      })),
      containsDiagram: entries.some(({ segment }) => segment.containsDiagram),
      languages,
      conflictingAttempts: entries.some(({ segment }) => segment.twoAttempts && isMarked(segment)),
    });
  }
  return result;
}

/** Languages other than English among the ones read, ignoring case. Mixed writing counts: a teacher reads it (decision D7). */
export function nonEnglishLanguages(languages: string[]): string[] {
  return languages.filter((language) => !/^english$/i.test(language.trim()));
}
