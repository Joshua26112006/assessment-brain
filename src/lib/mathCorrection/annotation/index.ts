import crypto from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { localFileStorage } from "@/lib/storage/localFileStorage";
import { analysePage, locateTextOnPage, type BBox, type QuestionMarker } from "@/lib/mathCorrection/annotation/textractPage";
import { buildOverlaySvg, type QuestionMark } from "@/lib/mathCorrection/annotation/overlay";
import type { ErrorExplanation } from "@/types/mathCorrection";

/**
 * Produces the marked-up copy of a student's answer sheet: ticks, awarded
 * marks, the total, and a ring around each confirmed mistake, drawn onto the
 * page they actually wrote.
 *
 * Best-effort by design and never throws. A page that cannot be analysed,
 * drawn or stored is simply left unannotated — the marks and written feedback
 * are already recorded elsewhere, so failing here must never cost a student
 * their result. Every failure is reported back per page rather than swallowed
 * silently, so a systematically failing annotator is visible.
 *
 * The student's original page is never modified; the annotated copy is stored
 * under its own key.
 */

export interface AnnotatablePage {
  pageId: string;
  pageNumber: number;
  submissionId: string;
  buffer: Buffer;
}

export interface AnnotatableQuestion {
  questionNumber: number;
  awardedMarks: number;
  maximumMarks: number;
  /** Confirmed findings only — nothing unverified ever reaches the page. */
  explanations: ErrorExplanation[];
  /** Pages the reading stage saw this answer on, used when no marker is found. */
  sourcePages: number[];
}

export interface AnnotationOutcome {
  pageNumber: number;
  annotated: boolean;
  /** Short and safe — never a raw provider error body or stack trace. */
  reason: string | null;
}

const JPEG_QUALITY = 93;

/**
 * A question with no detected marker is placed just below the top of the page
 * the reading stage says it was written on. Approximate on purpose: without a
 * marker there is no way to know where on that page the answer starts, but a
 * tick somewhere on the right page is more useful to a student than none.
 */
const FALLBACK_MARKER_TOP = 0.12;

function fallbackMarkerFor(question: AnnotatableQuestion, pageNumber: number): QuestionMarker | null {
  if (!question.sourcePages.includes(pageNumber)) return null;
  return {
    bbox: { left: 0.05, top: FALLBACK_MARKER_TOP, width: 0.05, height: 0.03 },
    column: "full",
  };
}

/**
 * Restricts a mistake search to one question's own answer region — from its
 * marker down to wherever the next question starts on this page — so a quote
 * can never be matched against another question's working.
 */
function regionBounds(
  markerTop: number,
  allMarkerTops: number[],
): { top: number; bottom: number } {
  const next = allMarkerTops.filter((top) => top > markerTop).sort((a, b) => a - b)[0];
  return { top: markerTop, bottom: next ?? 1.01 };
}

async function annotateOnePage(
  page: AnnotatablePage,
  questions: AnnotatableQuestion[],
  total: { awarded: number; maximum: number } | null,
): Promise<AnnotationOutcome> {
  const metadata = await sharp(page.buffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    return { pageNumber: page.pageNumber, annotated: false, reason: "Page dimensions could not be read." };
  }

  const analysis = await analysePage(
    page.buffer,
    questions.map((question) => question.questionNumber),
  );

  // Resolve each question to a position on THIS page, preferring the marker
  // Textract found and falling back to what the reading stage recorded.
  const placements = questions
    .map((question) => {
      const marker =
        analysis.markers.get(question.questionNumber) ?? fallbackMarkerFor(question, page.pageNumber);
      return marker ? { question, marker } : null;
    })
    .filter((entry): entry is { question: AnnotatableQuestion; marker: QuestionMarker } => entry !== null);

  if (placements.length === 0) {
    return { pageNumber: page.pageNumber, annotated: false, reason: "No question could be located on this page." };
  }

  const markerTops = placements.map((entry) => entry.marker.bbox.top);

  const mistakes: BBox[] = [];
  for (const { question, marker } of placements) {
    if (question.explanations.length === 0) continue;

    const { top, bottom } = regionBounds(marker.bbox.top, markerTops);
    const wordsInRegion = analysis.readingOrderWords.filter((word) => {
      const wordTop = word.Geometry?.BoundingBox?.Top ?? -1;
      return wordTop >= top && wordTop < bottom;
    });

    for (const explanation of question.explanations) {
      // A missing step has nothing written to circle.
      if (!explanation.wrongText) continue;
      const box = locateTextOnPage(wordsInRegion, explanation.wrongText);
      if (box) mistakes.push(box);
    }
  }

  const questionMarks: QuestionMark[] = placements.map(({ question, marker }) => ({
    markerTop: marker.bbox.top + marker.bbox.height / 2,
    column: marker.column,
    awardedMarks: question.awardedMarks,
    maximumMarks: question.maximumMarks,
  }));

  const svg = buildOverlaySvg({ width, height, questions: questionMarks, mistakes, total });

  const annotatedBuffer = await sharp(page.buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  // Same namespacing as the original upload (see storage/answerSheets.ts), so
  // a submission's originals and annotated copies live side by side.
  const annotatedKey = `${page.submissionId}/annotated-${page.pageNumber}-${crypto.randomBytes(8).toString("hex")}.jpg`;

  await localFileStorage.write(annotatedKey, annotatedBuffer);

  try {
    await prisma.answerSheetPage.update({
      where: { id: page.pageId },
      data: { annotatedStorageKey: annotatedKey },
    });
  } catch (error) {
    // The row could not be pointed at the new file, so nothing will ever read
    // it — remove it rather than leaving an orphan behind.
    await localFileStorage.remove(annotatedKey).catch(() => {});
    throw error;
  }

  return { pageNumber: page.pageNumber, annotated: true, reason: null };
}

export async function annotateAnswerSheet(
  pages: AnnotatablePage[],
  questions: AnnotatableQuestion[],
  total: { awarded: number; maximum: number } | null,
): Promise<AnnotationOutcome[]> {
  const outcomes: AnnotationOutcome[] = [];

  // Sequential rather than parallel: each page is a separate Textract call
  // plus an image composite, and running a whole submission's pages at once
  // spikes both memory and the provider's rate limit for no user-visible gain.
  for (const [index, page] of pages.entries()) {
    try {
      outcomes.push(await annotateOnePage(page, questions, index === 0 ? total : null));
    } catch (error) {
      console.error(`Failed to annotate answer sheet page ${page.pageNumber}`, error);
      outcomes.push({
        pageNumber: page.pageNumber,
        annotated: false,
        reason: "This page could not be annotated.",
      });
    }
  }

  return outcomes;
}
