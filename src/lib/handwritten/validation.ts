import { ALLOWED_ANSWER_SHEET_MIME_TYPES } from "@/lib/storage/answerSheets";
import type { DeterministicValidationResult, HandwrittenPageInput } from "./types";

/**
 * Bounds the total bytes handed to one AI call — mirrors the same gap this
 * project already closed for question papers
 * (MAX_QUESTION_PAPER_TOTAL_BYTES in src/lib/storage/questionPapers.ts).
 * AnswerSheetPage uploads have no page-count or aggregate-size cap today
 * (only a 10MB-per-file cap), so without this check a submission with many
 * large pages could produce an unreasonably large single request. This
 * guards the AI call this phase introduces; it does not change the upload
 * endpoint itself, which is out of this phase's scope.
 */
export const MAX_TOTAL_HANDWRITTEN_BYTES = 60 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>(ALLOWED_ANSWER_SHEET_MIME_TYPES);

/**
 * Cheap, deterministic checks run before any AI spend. Every one of these
 * conditions should be structurally prevented by the Phase 3.1/3.2 upload
 * path already (page-number uniqueness, per-file size, MIME sniffing,
 * non-empty content) — these are defense-in-depth, not the primary gate,
 * and a genuine failure here indicates either data corruption or a
 * configuration limit, never a judgment about whether the student's answers
 * are any good.
 */
export function runDeterministicValidation(
  pages: HandwrittenPageInput[],
): DeterministicValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (pages.length === 0) {
    errors.push("No answer-sheet pages were found for this submission.");
    return { outcome: "INVALID", errors, warnings };
  }

  const seenPageNumbers = new Set<number>();
  let previousPageNumber = 0;
  let totalBytes = 0;

  for (const page of pages) {
    if (seenPageNumbers.has(page.pageNumber)) {
      errors.push(`Page number ${page.pageNumber} appears more than once.`);
    }
    seenPageNumbers.add(page.pageNumber);

    if (page.pageNumber <= previousPageNumber) {
      errors.push("Pages were not loaded in strictly increasing order.");
    }
    if (page.pageNumber > previousPageNumber + 1) {
      // A gap is possible today (a student can delete a middle page while
      // still DRAFT) and is not itself a problem — the remaining pages are
      // still validly ordered relative to each other — but it's worth
      // recording in case it's relevant to interpreting the reading result.
      warnings.push(`Page numbering skips from ${previousPageNumber} to ${page.pageNumber}.`);
    }
    previousPageNumber = page.pageNumber;

    if (page.buffer.length === 0) {
      errors.push(`Page ${page.pageNumber} is empty.`);
    }
    if (!ALLOWED_MIME_TYPES.has(page.mimeType)) {
      errors.push(`Page ${page.pageNumber} has an unsupported file type (${page.mimeType}).`);
    }

    totalBytes += page.buffer.length;
  }

  if (totalBytes > MAX_TOTAL_HANDWRITTEN_BYTES) {
    errors.push(
      `The combined size of all pages (${(totalBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the ${
        MAX_TOTAL_HANDWRITTEN_BYTES / (1024 * 1024)
      }MB limit for processing.`,
    );
  }

  if (errors.length > 0) {
    return { outcome: "INVALID", errors, warnings };
  }
  if (warnings.length > 0) {
    return { outcome: "WARNING", errors, warnings };
  }
  return { outcome: "VALID", errors, warnings };
}
