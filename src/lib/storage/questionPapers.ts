import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLocalFileStorage } from "./localFileStorage";
import { detectImageMimeType, isPdfSignature } from "./fileSignatures";

/**
 * Domain-specific question-paper storage operations — the Phase 3.3
 * counterpart to src/lib/storage/answerSheets.ts, sharing the same
 * FileStorageDriver interface and file-signature helpers but writing under
 * its own storage/question-papers/ namespace (see createLocalFileStorage).
 * Route handlers call these, never the raw driver or Prisma directly for
 * QuestionPaperPage rows, so storage and database state can't drift apart.
 */

const localQuestionPaperStorage = createLocalFileStorage("question-papers");

export const ALLOWED_QUESTION_PAPER_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** PDFs and scanned pages run larger than a single phone photo; still bounded. */
export const MAX_QUESTION_PAPER_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** A generous but firm cap on how many image pages one question paper may have. */
export const MAX_QUESTION_PAPER_PAGES = 20;

/**
 * Caps the SUM of all pages in one upload batch, not just each file
 * individually — MAX_QUESTION_PAPER_PAGES x MAX_QUESTION_PAPER_FILE_SIZE_BYTES
 * alone would allow a single request to read ~400MB into memory and send it
 * (base64-encoded, ~30% larger again) to the AI provider in one call. 60MB
 * comfortably covers a genuine multi-page phone-photographed paper (pages
 * are typically 1-5MB each) while keeping the worst case bounded.
 */
export const MAX_QUESTION_PAPER_TOTAL_BYTES = 60 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Sniffs the real file type from its first bytes — PDF signature or one of
 * the three image magic-byte checks — never trusting the browser-declared
 * Content-Type.
 */
export function detectQuestionPaperMimeType(buffer: Buffer): string | null {
  if (isPdfSignature(buffer)) return "application/pdf";
  return detectImageMimeType(buffer);
}

export interface QuestionPaperPageSummary {
  id: string;
  pageNumber: number;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: Date;
}

const PAGE_SUMMARY_SELECT = {
  id: true,
  pageNumber: true,
  originalFilename: true,
  mimeType: true,
  fileSizeBytes: true,
  createdAt: true,
} satisfies Prisma.QuestionPaperPageSelect;

/** Where the next uploaded page should land, continuing after whatever is already stored. */
export async function nextAvailableQuestionPaperPageNumber(
  questionPaperId: string,
): Promise<number> {
  const result = await prisma.questionPaperPage.aggregate({
    where: { questionPaperId },
    _max: { pageNumber: true },
  });
  return (result._max.pageNumber ?? 0) + 1;
}

export interface UploadQuestionPaperPageInput {
  questionPaperId: string;
  pageNumber: number;
  buffer: Buffer;
  originalFilename: string;
}

export type UploadQuestionPaperPageResult =
  | { ok: true; page: QuestionPaperPageSummary }
  | { ok: false; error: string };

/**
 * Validates, stores, and persists one question-paper page (PDF or image).
 *
 * Ordering matters for consistency, matching answerSheets.ts exactly: the
 * file is written to storage FIRST, and the database row is only created
 * after that succeeds; if the database write then fails (including the
 * questionPaperId+pageNumber uniqueness constraint), the just-written file
 * is deleted as compensation.
 */
export async function uploadQuestionPaperPage(
  input: UploadQuestionPaperPageInput,
): Promise<UploadQuestionPaperPageResult> {
  if (input.buffer.length === 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (input.buffer.length > MAX_QUESTION_PAPER_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File exceeds the ${MAX_QUESTION_PAPER_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  const sniffedMimeType = detectQuestionPaperMimeType(input.buffer);
  if (!sniffedMimeType) {
    return {
      ok: false,
      error: "Unsupported file type. Only PDF, JPEG, PNG, and WEBP are allowed.",
    };
  }

  const extension = EXTENSION_BY_MIME_TYPE[sniffedMimeType];
  const storageKey = `${input.questionPaperId}/${input.pageNumber}-${crypto
    .randomBytes(8)
    .toString("hex")}.${extension}`;

  await localQuestionPaperStorage.write(storageKey, input.buffer);

  try {
    const page = await prisma.questionPaperPage.create({
      data: {
        questionPaperId: input.questionPaperId,
        pageNumber: input.pageNumber,
        storageKey,
        originalFilename: input.originalFilename.slice(0, 255) || "page",
        mimeType: sniffedMimeType,
        fileSizeBytes: input.buffer.length,
      },
      select: PAGE_SUMMARY_SELECT,
    });
    return { ok: true, page };
  } catch (error) {
    await localQuestionPaperStorage.remove(storageKey).catch(() => {});

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: `Page ${input.pageNumber} already exists for this question paper.` };
    }
    return { ok: false, error: "Failed to save the uploaded page. Please try again." };
  }
}

/** Reads the raw bytes for an already-authorized page. Returns null if the file is missing. */
export async function readQuestionPaperPageContent(storageKey: string): Promise<Buffer | null> {
  return localQuestionPaperStorage.read(storageKey);
}

/** Best-effort storage cleanup for a page whose database row is being removed. */
export async function removeQuestionPaperPageFile(storageKey: string): Promise<void> {
  await localQuestionPaperStorage.remove(storageKey).catch(() => {});
}
