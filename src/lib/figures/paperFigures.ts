import sharp from "sharp";
import { findInkRegions, type PixelBox } from "@/lib/figures/inkRegions";
import { renderPdfPages } from "@/lib/figures/pdfPages";
import { locateMarkers, type MarkerTarget } from "@/lib/structuredCorrection/annotation/markers";

/**
 * The figures, graphs and tables of a digital question paper, cropped from its pages and tied to the question each
 * belongs to. Nothing here uses a model: the text positions come from the PDF itself, drawings are the marks that are
 * not text, and a figure belongs to the question whose number it follows.
 *
 * A figure that follows no question number (a diagram in the instructions) is kept with no question, for the teacher to
 * place. A figure the question refers back to from a later part ("1(b) ... using the figure") stays with the part it
 * follows; the scheme drafter is given every figure of the same numbered question (see figuresForQuestion).
 */

export interface DetectedFigure {
  pageNumber: number;
  /** Where on the page, as 0 to 1 fractions, so it survives a different render size. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The cropped picture. */
  png: Buffer;
  pixelWidth: number;
  pixelHeight: number;
  /** The question it follows, or null when it follows none. */
  questionNumber: number | null;
}

export interface FigureDetection {
  figures: DetectedFigure[];
  pagesRead: number;
  /** Plain-language things the teacher should know: nothing found, questions whose number could not be located. */
  notes: string[];
}

interface Marker {
  page: number;
  top: number;
  questionNumber: number;
}

/** The question a region follows: the latest question marker above it, on this page or an earlier one. */
export function questionFollowedBy(page: number, regionTop: number, markers: Marker[]): number | null {
  let best: Marker | null = null;
  for (const marker of markers) {
    const above = marker.page < page || (marker.page === page && marker.top <= regionTop);
    if (!above) continue;
    if (!best || marker.page > best.page || (marker.page === best.page && marker.top > best.top)) best = marker;
  }
  return best ? best.questionNumber : null;
}

export async function detectPaperFigures(pdf: Buffer, targets: MarkerTarget[], scale = 3): Promise<FigureDetection> {
  const pages = await renderPdfPages(pdf, { scale });
  const notes: string[] = [];

  // The options were tuned at 144 dots per inch (scale 2).
  const factor = scale / 2;
  // Drawings first: a line of writing inside one is a label or a table row, never the start of a question.
  const regionsByPage = pages.map((page) =>
    findInkRegions(page.gray, page.width, page.height, page.textBoxes, { joinGap: 24 * factor, minThickness: 8 * factor }),
  );

  // Every printed line of the paper in order, so the marker search can run over the whole paper at once.
  const all = pages.flatMap((page, pageIndex) =>
    page.lines.map((line) => ({
      pageIndex,
      line,
      // A line that cannot start a question is kept (so positions line up) but given no words to be mistaken for a number.
      candidate: canStartQuestion(line, regionsByPage[pageIndex]) ? line : { ...line, words: [] },
    })),
  );
  const found = locateMarkers(
    all.map((entry) => entry.candidate),
    targets,
  );
  const markers: Marker[] = [...found.entries()].map(([questionNumber, index]) => ({
    questionNumber,
    page: all[index].pageIndex,
    top: all[index].line.box.top,
  }));
  const missing = targets.filter((target) => !found.has(target.questionNumber));
  if (targets.length > 0 && missing.length > 0) {
    notes.push(
      `The number of ${missing.length === 1 ? "question" : "questions"} ${missing.map((t) => t.label ?? t.questionNumber).join(", ")} could not be located in the PDF, so a figure after ${missing.length === 1 ? "it" : "them"} may be attached to the question before.`,
    );
  }

  const figures: DetectedFigure[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    for (const region of regionsByPage[pageIndex]) {
      const padded = pad(region, Math.round(10 * factor), page.width, page.height);
      const cropWidth = padded.right - padded.left;
      const cropHeight = padded.bottom - padded.top;
      const png = await sharp(page.png).extract({ left: padded.left, top: padded.top, width: cropWidth, height: cropHeight }).png().toBuffer();
      figures.push({
        pageNumber: page.pageNumber,
        left: padded.left / page.width,
        top: padded.top / page.height,
        width: cropWidth / page.width,
        height: cropHeight / page.height,
        png,
        pixelWidth: cropWidth,
        pixelHeight: cropHeight,
        questionNumber: questionFollowedBy(pageIndex, region.top, markers),
      });
    }
  }

  if (figures.length === 0) notes.push("No figure, graph or table was found in the PDF.");
  return { figures, pagesRead: pages.length, notes };
}

/** Words that are only numbers and number punctuation: "1 4", "2 9", "13.5 %". */
const NUMBER_ONLY = /^[\d.,%()+\-−/:;]+$/;

/**
 * Whether a printed line could be where a question begins. Not if it lies inside a drawing (a table's rows begin with
 * numbers too), and not if it is nothing but numbers (a table without ruled lines, a row of data).
 */
export function canStartQuestion(line: { words: Array<{ text: string }>; box: PixelBox }, regions: PixelBox[]): boolean {
  if (line.words.length >= 2 && line.words.every((word) => NUMBER_ONLY.test(word.text))) return false;
  const middleX = (line.box.left + line.box.right) / 2;
  const middleY = (line.box.top + line.box.bottom) / 2;
  return !regions.some((region) => middleX >= region.left && middleX < region.right && middleY >= region.top && middleY < region.bottom);
}

function pad(box: PixelBox, amount: number, width: number, height: number): PixelBox {
  return {
    left: Math.max(0, Math.floor(box.left - amount)),
    top: Math.max(0, Math.floor(box.top - amount)),
    right: Math.min(width, Math.ceil(box.right + amount)),
    bottom: Math.min(height, Math.ceil(box.bottom + amount)),
  };
}
