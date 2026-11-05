import crypto from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  removeAnnotatedAnswerSheetPage,
  writeAnnotatedAnswerSheetPage,
} from "@/lib/storage/answerSheets";
import { analysePage, locateTextOnPage, type BBox, type QuestionMarker } from "@/lib/structuredCorrection/annotation/textractPage";
import { buildOverlaySvg, type QuestionMark } from "@/lib/structuredCorrection/annotation/overlay";
import type { PlacementOutcome } from "@/lib/structuredCorrection/annotation/placement";
import type { ErrorExplanation } from "@/types/structuredCorrection";

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
  /** What the paper calls it and the student writes ("3(b)"); null reads as the question number. */
  label?: string | null;
  /** Answered, but a better alternative counts instead: drawn with a * and left out of the total. */
  overAttempt?: boolean;
  awardedMarks: number;
  maximumMarks: number;
  /** Confirmed findings only — nothing unverified ever reaches the page. */
  explanations: ErrorExplanation[];
  /** Pages the reading stage saw this answer on, used when no marker is found. */
  sourcePages: number[];
}

export interface AnnotationOutcome extends PlacementOutcome {
  pageNumber: number;
  annotated: boolean;
  /** Short and safe — never a raw provider error body or stack trace. */
  reason: string | null;
}

const JPEG_QUALITY = 93;

// A question whose own marker cannot be found on the page is NOT drawn at a guessed position. It used to be
// placed "somewhere near the top of the page it was written on"; with several such questions every mark and
// tick landed in the same place on top of each other, and a mark in the wrong place on a student's own paper
// is worse than none. The teacher is told which questions could not be placed (see placement.ts).

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
    return { pageNumber: page.pageNumber, annotated: false, reason: "Page dimensions could not be read.", placedQuestions: [], circled: [] };
  }

  const analysis = await analysePage(
    page.buffer,
    questions.map((question) => ({ questionNumber: question.questionNumber, label: question.label ?? null })),
  );

  // A question is drawn on THIS page only where Textract found its own marker.
  const placements = questions
    .map((question) => {
      const marker = analysis.markers.get(question.questionNumber);
      return marker ? { question, marker } : null;
    })
    .filter((entry): entry is { question: AnnotatableQuestion; marker: QuestionMarker } => entry !== null);

  if (placements.length === 0 && total === null) {
    return { pageNumber: page.pageNumber, annotated: false, reason: "No question could be located on this page.", placedQuestions: [], circled: [] };
  }

  const markerTops = placements.map((entry) => entry.marker.bbox.top);

  const mistakes: BBox[] = [];
  const circled: Array<{ questionNumber: number; errorId: string }> = [];
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
      if (box) {
        mistakes.push(box);
        circled.push({ questionNumber: question.questionNumber, errorId: explanation.errorId });
      }
    }
  }

  const questionMarks: QuestionMark[] = placements.map(({ question, marker }) => ({
    markerTop: marker.bbox.top + marker.bbox.height / 2,
    markerLeft: marker.bbox.left,
    column: marker.column,
    awardedMarks: question.awardedMarks,
    maximumMarks: question.maximumMarks,
    overAttempt: question.overAttempt === true,
  }));

  const svg = buildOverlaySvg({
    width,
    height,
    questions: questionMarks,
    mistakes,
    total,
    occupied: analysis.readingOrderWords.flatMap((word) => {
      const box = word.Geometry?.BoundingBox;
      return box && box.Left !== undefined && box.Top !== undefined && box.Width !== undefined && box.Height !== undefined
        ? [{ left: box.Left, top: box.Top, width: box.Width, height: box.Height }]
        : [];
    }),
  });

  const annotatedBuffer = await sharp(page.buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  // Same namespacing as the original upload (see storage/answerSheets.ts), so
  // a submission's originals and annotated copies live side by side.
  const annotatedKey = `${page.submissionId}/annotated-${page.pageNumber}-${crypto.randomBytes(8).toString("hex")}.jpg`;

  await writeAnnotatedAnswerSheetPage(annotatedKey, annotatedBuffer);

  const previous = await prisma.answerSheetPage.findUnique({ where: { id: page.pageId }, select: { annotatedStorageKey: true } });

  try {
    await prisma.answerSheetPage.update({
      where: { id: page.pageId },
      data: { annotatedStorageKey: annotatedKey },
    });
  } catch (error) {
    // The row could not be pointed at the new file, so nothing will ever read
    // it — remove it rather than leaving an orphan behind.
    await removeAnnotatedAnswerSheetPage(annotatedKey);
    throw error;
  }

  // The copy this one replaces is not read any more.
  if (previous?.annotatedStorageKey && previous.annotatedStorageKey !== annotatedKey) {
    await removeAnnotatedAnswerSheetPage(previous.annotatedStorageKey);
  }

  return {
    pageNumber: page.pageNumber,
    annotated: true,
    reason: null,
    placedQuestions: placements.map(({ question }) => question.questionNumber),
    circled,
  };
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
        placedQuestions: [],
        circled: [],
      });
    }
  }

  return outcomes;
}
