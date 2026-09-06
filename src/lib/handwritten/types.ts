/**
 * Handwritten submission processing contracts (Phase 3.4A/3.4B).
 *
 * Deliberately separate from src/types/pipeline.ts: that file describes
 * evaluating one QuestionResponse against a rubric. Nothing here decides a
 * mark, runs correction, or creates QuestionResponse rows — this phase only
 * turns a Submission's AnswerSheetPage[] into a structured, persisted
 * answer index ready for a LATER evaluation phase (Phase 3.4C) to consume.
 */

import type { ConfidenceScore } from "@/types/assessmentBrain";

// ---------------------------------------------------------------------------
// Deterministic validation (cheap checks, before any AI call)
// ---------------------------------------------------------------------------

export type DeterministicValidationOutcome = "VALID" | "INVALID" | "WARNING";

export interface DeterministicValidationResult {
  outcome: DeterministicValidationOutcome;
  /** Specific, actionable problems that make processing unsafe to continue (outcome INVALID). */
  errors: string[];
  /** Non-fatal oddities worth recording even though processing can continue (outcome WARNING). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Page input (normalized, storage-abstraction-agnostic)
// ---------------------------------------------------------------------------

/** One answer-sheet page's bytes, ready to hand to the AI layer — no storage keys or paths. */
export interface HandwrittenPageInput {
  pageId: string;
  pageNumber: number;
  mimeType: string;
  buffer: Buffer;
}

// ---------------------------------------------------------------------------
// AI answer-sheet validation gate
// ---------------------------------------------------------------------------

export type AnswerSheetValidationDecision = "VALID" | "INVALID" | "UNCERTAIN";

export interface PageObservation {
  pageNumber: number;
  /** Whether this specific page looks like a handwritten answer-sheet page at all. */
  looksLikeAnswerSheet: boolean;
  /** Whether this page appears to have no meaningful written content. */
  isBlank: boolean;
  /** A short, specific observation — only when genuinely notable (e.g. "duplicate of page 1"). Never a generic disclaimer. */
  note: string | null;
}

export interface AnswerSheetValidationResult {
  decision: AnswerSheetValidationDecision;
  confidence: ConfidenceScore;
  /** Short, machine-usable codes (e.g. "NOT_AN_ANSWER_SHEET", "ALL_PAGES_BLANK", "DUPLICATE_PAGES", "LOW_LEGIBILITY"). Empty when decision is VALID with nothing notable. */
  reasonCodes: string[];
  pageObservations: PageObservation[];
  warnings: string[];
}

/** Raw, not-yet-validated shape of what the model actually returned for the validation gate. */
export interface RawAnswerSheetValidation {
  decision?: unknown;
  confidence?: unknown;
  reasonCodes?: unknown;
  pageObservations?: unknown;
  warnings?: unknown;
}

// ---------------------------------------------------------------------------
// Global answer index (the reading + mapping output)
// ---------------------------------------------------------------------------

/**
 * One piece of detected written content — either mapped to a real assessment
 * question (questionId/mappedQuestionNumber set) or left unmapped
 * (questionId/mappedQuestionNumber null, e.g. a stray note, an illegible
 * fragment, or content the model couldn't confidently associate with any
 * question). Never fabricated: text always reflects what the model reported
 * reading, never an invented answer.
 */
export interface AnswerIndexEntry {
  /** Stable id within this one processing attempt — for cross-referencing from warnings/UI, not a database id. */
  localId: string;
  /** What the student appears to have written as a question label, verbatim intent (may be null if no number was written). */
  detectedQuestionNumber: number | null;
  /** Resolved against real Question rows for this assessment — null until mapping, and null forever if unmapped. */
  questionId: string | null;
  /** The real Question.questionNumber this was mapped to, if any — always a genuine existing question number, never invented. */
  mappedQuestionNumber: number | null;
  /** Transcribed content, preserving the student's wording — never paraphrased or corrected. */
  text: string;
  /** Ordered AnswerSheetPage.pageNumber values this content was found across — supports answers spanning multiple pages. */
  sourcePages: number[];
  /** Confidence that this content belongs to the mapped question — null when unmapped. */
  mappingConfidence: ConfidenceScore | null;
  /** Confidence in the transcription itself, independent of mapping. */
  readingConfidence: ConfidenceScore;
  /** True if either the mapping or the transcription is genuinely uncertain — surfaced for later cautious handling, never hidden. */
  uncertain: boolean;
  /** Specific caveats about this one entry (e.g. "continues past an illegible line"). */
  warnings: string[];
}

/** A real assessment question with no detected content at all — computed deterministically, never asked of the AI. */
export interface UnansweredQuestion {
  questionId: string;
  questionNumber: number;
}

export interface StructuredAnswerIndex {
  entries: AnswerIndexEntry[];
  unansweredQuestions: UnansweredQuestion[];
  overallWarnings: string[];
}

/** Raw, not-yet-validated shape of one answer entry as the model returned it. */
export interface RawAnswerIndexEntry {
  detectedQuestionNumber?: unknown;
  mappedQuestionNumber?: unknown;
  text?: unknown;
  sourcePages?: unknown;
  mappingConfidence?: unknown;
  readingConfidence?: unknown;
  uncertain?: unknown;
  warnings?: unknown;
}

/**
 * Raw, not-yet-validated shape of the ONE combined AI response — validation
 * gate + global reading together (see src/lib/handwritten/answerReading.ts
 * for why these are one call, not two).
 */
export interface RawHandwrittenProcessingResponse {
  validation?: RawAnswerSheetValidation;
  answers?: unknown;
}

// ---------------------------------------------------------------------------
// Overall processing result (what gets persisted)
// ---------------------------------------------------------------------------

export type HandwrittenProcessingOutcome = "READY" | "INVALID" | "FAILED";

export interface HandwrittenProcessingResult {
  outcome: HandwrittenProcessingOutcome;
  validationResult: AnswerSheetValidationResult | null;
  answerIndex: StructuredAnswerIndex | null;
  /** Set only when outcome is FAILED — short and safe, never a raw stack trace. */
  processingError: string | null;
}
