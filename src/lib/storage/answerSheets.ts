import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { localFileStorage } from "./localFileStorage";
import { detectImageMimeType } from "./fileSignatures";

/**
 * Domain-specific answer-sheet storage operations. Route handlers call
 * these, never the raw FileStorageDriver or Prisma directly for
 * AnswerSheetPage rows — this is the one place upload/delete/read for
 * answer sheets is implemented, so storage and database state can't drift
 * apart in two different call sites.
 */

export const ALLOWED_ANSWER_SHEET_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** A generous cap for a single phone photo of an exam page. */
export const MAX_ANSWER_SHEET_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface AnswerSheetPageSummary {
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
} satisfies Prisma.AnswerSheetPageSelect;

/** Where the next uploaded page should land, continuing after whatever is already stored. */
export async function nextAvailablePageNumber(submissionId: string): Promise<number> {
  const result = await prisma.answerSheetPage.aggregate({
    where: { submissionId },
    _max: { pageNumber: true },
  });
  return (result._max.pageNumber ?? 0) + 1;
}

export interface UploadAnswerSheetPageInput {
  submissionId: string;
  pageNumber: number;
  buffer: Buffer;
  originalFilename: string;
}

export type UploadAnswerSheetPageResult =
  | { ok: true; page: AnswerSheetPageSummary }
  | { ok: false; error: string };

/**
 * Validates, stores, and persists one answer-sheet page.
 *
 * Ordering matters for consistency: the file is written to storage FIRST,
 * and the database row is only created after that succeeds — so a storage
 * failure can never leave behind a database row with nothing backing it.
 * If the database write then fails for any reason (including the
 * submissionId+pageNumber uniqueness constraint), the just-written file is
 * deleted as compensation so a failed upload never leaves an orphaned file.
 */
export async function uploadAnswerSheetPage(
  input: UploadAnswerSheetPageInput,
): Promise<UploadAnswerSheetPageResult> {
  if (input.buffer.length === 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (input.buffer.length > MAX_ANSWER_SHEET_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File exceeds the ${MAX_ANSWER_SHEET_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  const sniffedMimeType = detectImageMimeType(input.buffer);
  if (!sniffedMimeType) {
    return {
      ok: false,
      error: "Unsupported file type. Only JPEG, PNG, and WEBP images are allowed.",
    };
  }

  const extension = EXTENSION_BY_MIME_TYPE[sniffedMimeType];
  const storageKey = `${input.submissionId}/${input.pageNumber}-${crypto
    .randomBytes(8)
    .toString("hex")}.${extension}`;

  await localFileStorage.write(storageKey, input.buffer);

  try {
    const page = await prisma.answerSheetPage.create({
      data: {
        submissionId: input.submissionId,
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
    // Compensation: the database write failed, so don't leave the file
    // behind with no row pointing at it. Best-effort — if this delete
    // itself fails, the orphaned file is a storage cleanup concern, never
    // a correctness one (no row references it, so nothing reads it back).
    await localFileStorage.remove(storageKey).catch(() => {});

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: `Page ${input.pageNumber} already exists for this submission.` };
    }
    return { ok: false, error: "Failed to save the uploaded page. Please try again." };
  }
}

/**
 * Deletes both the database row and the underlying file. Database deletion
 * happens first — if it fails, nothing is touched in storage. If the
 * database delete succeeds but the storage delete fails, the row is
 * already gone (so nothing can read the orphaned file back through this
 * application); that failure is swallowed rather than surfaced, matching
 * how compensation cleanup is handled during upload.
 */
export async function deleteAnswerSheetPage(page: { id: string; storageKey: string }): Promise<void> {
  await prisma.answerSheetPage.delete({ where: { id: page.id } });
  await localFileStorage.remove(page.storageKey).catch(() => {});
}

/** Reads the raw bytes for an already-authorized page. Returns null if the file is missing. */
export async function readAnswerSheetPageContent(storageKey: string): Promise<Buffer | null> {
  return localFileStorage.read(storageKey);
}
