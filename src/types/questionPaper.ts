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
  /**
   * Unique within the paper. For a paper with no parts or choices it is the printed question number;
   * for one with structure it is the answerable question's position in paper order.
   */
  number: number;
  /** What the paper calls it: "3", "3(b)". Absent in drafts stored before parts were read. */
  label?: string;
  text: string;
  marks: number | null;
  uncertain: boolean;
  /** The model's suggestion for how this is marked; a teacher confirms it. Never decided by the model alone. */
  answerType?: QuestionAnswerTypeName;
}

export type QuestionAnswerTypeName = "NUMERIC" | "SHORT_TEXT" | "DESCRIPTIVE" | "ESSAY" | "EXACT_KEY" | "DIAGRAM";

/** How the answerable questions of a draft combine; leaves refer to a question by its `number`. */
export type DraftTreeNode =
  | { kind: "LEAF"; number: number }
  | { kind: "GROUP"; label?: string; children: DraftTreeNode[] }
  | { kind: "CHOICE"; label?: string; children: DraftTreeNode[] }
  | { kind: "OPTIONAL"; label?: string; pick: number; children: DraftTreeNode[] };

/** The full structured draft produced by one extraction attempt. */
export interface ExtractedPaperDraft {
  title: string | null;
  instructions: string | null;
  questions: ExtractedQuestionDraft[];
  /** How the questions combine (parts, "(a) OR (b)", "any N of M"). Null or absent for a plain list. */
  tree?: DraftTreeNode[] | null;
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
