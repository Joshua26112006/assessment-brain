import { prisma } from "@/lib/prisma";
import { readQuestionPaperPageContent } from "@/lib/storage/questionPapers";
import { extractQuestionPaperWithAi } from "./ai";

/**
 * Runs (or re-runs) AI extraction for one QuestionPaper and persists the
 * result. Never throws — every failure path (missing pages, storage read
 * failure, AI/network failure, malformed AI output) is caught and persisted
 * as extractionStatus FAILED with a plain-language extractionError, so a
 * teacher never sees a silently-stuck PROCESSING row or an unhandled
 * exception. Safe to call from a background `after()` task (upload) or a
 * synchronous Server Action (retry) — both just await this and re-read the
 * row afterward.
 */
export async function runQuestionPaperExtraction(questionPaperId: string): Promise<void> {
  await prisma.questionPaper.update({
    where: { id: questionPaperId },
    data: { extractionStatus: "PROCESSING", extractionError: null },
  });

  try {
    const pages = await prisma.questionPaperPage.findMany({
      where: { questionPaperId },
      orderBy: { pageNumber: "asc" },
      select: { storageKey: true, mimeType: true },
    });

    if (pages.length === 0) {
      throw new Error("This question paper has no uploaded pages.");
    }

    const pageInputs = await Promise.all(
      pages.map(async (page) => {
        const buffer = await readQuestionPaperPageContent(page.storageKey);
        if (!buffer) {
          throw new Error("One of the uploaded pages is no longer available in storage.");
        }
        return { mimeType: page.mimeType, buffer };
      }),
    );

    const draft = await extractQuestionPaperWithAi(pageInputs);

    await prisma.questionPaper.update({
      where: { id: questionPaperId },
      data: {
        extractionStatus: "EXTRACTED",
        extractedContent: draft as unknown as object,
        extractionError: null,
      },
    });
  } catch (error) {
    // Never persist a raw stack trace or provider error body (potentially
    // containing request internals) — a short, plain message only.
    const message =
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : "Extraction failed unexpectedly. Please try again.";

    await prisma.questionPaper
      .update({
        where: { id: questionPaperId },
        data: { extractionStatus: "FAILED", extractionError: message },
      })
      .catch(() => {
        // The row may have been deleted concurrently (teacher clicked
        // "start over" mid-extraction) — nothing left to mark as failed.
      });
  }
}
