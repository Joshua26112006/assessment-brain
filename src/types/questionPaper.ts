/**
 * Question-paper ingestion & extraction contracts (Phase 3.3).
 *
 * Deliberately separate from src/types/pipeline.ts: that file describes
 * evaluating one QuestionResponse against a rubric, an entirely different
 * concern from turning an uploaded document into a reviewable draft of
 * Questions. Nothing here is persisted to QuestionResponse, and nothing in
 * pipeline.ts is reused here.
 */

/**
 * One question as the AI extracted it, before any teacher edit. Marks are
 * nullable — the model must never invent a mark it didn't actually see on
 * the paper (see the extraction prompt) — and `uncertain` lets the model
 * flag genuine doubt (e.g. a smudged number) instead of confidently
 * fabricating a reading. Sub-parts (a/b/c under one numbered question) are
 * preserved as a single question's text rather than flattened into
 * separate top-level questions, since the existing Question model has no
 * concept of sub-parts.
 */
export interface ExtractedQuestionDraft {
  number: number;
  text: string;
  marks: number | null;
  uncertain: boolean;
}

/** The full structured draft produced by one extraction attempt. */
export interface ExtractedPaperDraft {
  title: string | null;
  instructions: string | null;
  questions: ExtractedQuestionDraft[];
  /** The model's own reported total, kept only as a cross-check — never authoritative on its own. */
  totalMarks: number | null;
  /** Genuine extraction-time caveats (e.g. "page 2 was partially illegible"), never fabricated confidence. */
  extractionWarnings: string[];
}

/** Raw, not-yet-validated shape of what the model actually returned. */
export interface RawExtractedPaperDraft {
  title?: unknown;
  instructions?: unknown;
  questions?: unknown;
  totalMarks?: unknown;
  extractionWarnings?: unknown;
}
