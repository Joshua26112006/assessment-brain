import { prisma } from "@/lib/prisma";
import { readAnswerSheetPageContent } from "@/lib/storage/answerSheets";
import type { HandwrittenPageInput } from "./types";

/**
 * Loads one submission's answer-sheet pages, in order, with their actual
 * bytes — the only way the handwritten-processing layer ever touches
 * storage. Server-only; never exposes a storage key or filesystem path to
 * any caller. Reuses the exact same read path
 * (readAnswerSheetPageContent/localFileStorage) the student/teacher
 * page-viewing routes already use, so there is exactly one place answer-sheet
 * bytes are ever read from disk.
 *
 * Throws (rather than silently skipping) if a page's row exists but its
 * file is missing — that is a genuine storage-layer inconsistency, not a
 * "this page doesn't exist" case, and the caller should treat it as a
 * technical processing failure, never as if the page were simply absent.
 */
export async function loadOrderedAnswerSheetPages(
  submissionId: string,
): Promise<HandwrittenPageInput[]> {
  const pages = await prisma.answerSheetPage.findMany({
    where: { submissionId },
    orderBy: { pageNumber: "asc" },
    select: { id: true, pageNumber: true, mimeType: true, storageKey: true },
  });

  return Promise.all(
    pages.map(async (page): Promise<HandwrittenPageInput> => {
      const buffer = await readAnswerSheetPageContent(page.storageKey);
      if (!buffer) {
        throw new Error(`Page ${page.pageNumber} is no longer available in storage.`);
      }
      return {
        pageId: page.id,
        pageNumber: page.pageNumber,
        mimeType: page.mimeType,
        buffer,
      };
    }),
  );
}
