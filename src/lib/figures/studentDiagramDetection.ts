import sharp from "sharp";
import { questionFollowedBy } from "@/lib/figures/paperFigures";
import { inkDiagramBoxes, reconcileDiagrams } from "@/lib/figures/studentDiagrams";
import type { PixelBox } from "@/lib/figures/inkRegions";
import type { MarkerTarget } from "@/lib/structuredCorrection/annotation/markers";
import type { PageAnalysis } from "@/lib/structuredCorrection/annotation/textractPage";

/**
 * Finds, crops and files the hand-drawn diagrams of a student's answer sheet, page by page. Each diagram is found by two
 * independent methods (ink, and the reader model's opinion) and is "confident" only where they agree. A diagram belongs
 * to the question whose marker most recently precedes it, on its page or an earlier one.
 *
 * The two outside services (the text detector and the model) are passed in, so this can be tested without either.
 */

export interface StudentPage {
  pageNumber: number;
  buffer: Buffer;
}

export interface DetectedStudentDiagram {
  pageNumber: number;
  /** Where on the page, as 0 to 1 fractions. */
  left: number;
  top: number;
  width: number;
  height: number;
  png: Buffer;
  pixelWidth: number;
  pixelHeight: number;
  /** The question it follows, or null when it follows none. */
  questionNumber: number | null;
  confident: boolean;
  foundByInk: boolean;
  foundByModel: boolean;
}

export interface DiagramDetection {
  diagrams: DetectedStudentDiagram[];
  /** Plain-language caveats for the teacher: a page that could not be read for writing, a model that could not be asked. */
  notes: string[];
}

export interface DetectionServices {
  /** Where the writing and the question markers are on a page. Throws when the text detector is unavailable. */
  analyse(jpeg: Buffer, targets: MarkerTarget[]): Promise<PageAnalysis>;
  /** The model's boxes in pixels of the picture it was shown; null when it could not be asked. */
  locate(jpeg: Buffer, width: number, height: number): Promise<PixelBox[] | null>;
}

/** Pages are examined at this width: plenty to see a drawing, and fast. */
const WORK_WIDTH = 1600;

export async function detectStudentDiagrams(
  pages: StudentPage[],
  targets: MarkerTarget[],
  services: DetectionServices,
  options: { flaggedPages?: ReadonlySet<number> } = {},
): Promise<DiagramDetection> {
  const notes: string[] = [];
  const markers: Array<{ page: number; top: number; questionNumber: number }> = [];
  const perPage: Array<{
    pageIndex: number;
    pageNumber: number;
    oriented: Buffer;
    orientedWidth: number;
    workWidth: number;
    workHeight: number;
    found: ReturnType<typeof reconcileDiagrams>;
  }> = [];

  for (const [pageIndex, page] of pages.entries()) {
    // The page the way a person holds it, so every box is on the same picture the teacher sees.
    const oriented = await sharp(page.buffer).rotate().toBuffer();
    const orientedMeta = await sharp(oriented).metadata();
    if (!orientedMeta.width || !orientedMeta.height) continue;
    const work = await sharp(oriented).resize({ width: WORK_WIDTH, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
    const workWidth = work.info.width;
    const workHeight = work.info.height;
    const gray = await sharp(work.data).greyscale().raw().toBuffer();
    const jpeg = await sharp(work.data).jpeg({ quality: 85 }).toBuffer();

    let analysis: PageAnalysis | null = null;
    try {
      analysis = await services.analyse(jpeg, targets);
    } catch {
      notes.push(`Page ${page.pageNumber}: the writing could not be told from drawing, so no diagram on it is treated as certain.`);
    }

    let inkBoxes: PixelBox[] = [];
    if (analysis) {
      for (const [questionNumber, marker] of analysis.markers) {
        markers.push({ page: pageIndex, top: marker.bbox.top, questionNumber });
      }
      const textBoxes: PixelBox[] = analysis.readingOrderWords.flatMap((word) => {
        const box = word.Geometry?.BoundingBox;
        if (!box || box.Left === undefined || box.Top === undefined || box.Width === undefined || box.Height === undefined) return [];
        return [{
          left: Math.floor(box.Left * workWidth),
          top: Math.floor(box.Top * workHeight),
          right: Math.ceil((box.Left + box.Width) * workWidth),
          bottom: Math.ceil((box.Top + box.Height) * workHeight),
        }];
      });
      inkBoxes = inkDiagramBoxes(gray, workWidth, workHeight, textBoxes);
    }

    // The model is asked only where there is something to check: ink was found, or the reader said this page has a drawing.
    const flagged = options.flaggedPages?.has(page.pageNumber) === true;
    const modelBoxes = inkBoxes.length > 0 || flagged || !analysis ? await services.locate(jpeg, workWidth, workHeight) : [];
    if (modelBoxes === null) notes.push(`Page ${page.pageNumber}: the model could not be asked where the diagrams are, so none on it is treated as certain.`);

    perPage.push({
      pageIndex,
      pageNumber: page.pageNumber,
      oriented,
      orientedWidth: orientedMeta.width,
      workWidth,
      workHeight,
      found: reconcileDiagrams(inkBoxes, modelBoxes),
    });
  }

  const diagrams: DetectedStudentDiagram[] = [];
  for (const entry of perPage) {
    const scale = entry.orientedWidth / entry.workWidth;
    for (const found of entry.found) {
      const padded = pad(found.box, 12, entry.workWidth, entry.workHeight);
      const crop = {
        left: Math.round(padded.left * scale),
        top: Math.round(padded.top * scale),
        width: Math.max(1, Math.round((padded.right - padded.left) * scale)),
        height: Math.max(1, Math.round((padded.bottom - padded.top) * scale)),
      };
      const png = await sharp(entry.oriented).extract(crop).png().toBuffer();
      diagrams.push({
        pageNumber: entry.pageNumber,
        left: padded.left / entry.workWidth,
        top: padded.top / entry.workHeight,
        width: (padded.right - padded.left) / entry.workWidth,
        height: (padded.bottom - padded.top) / entry.workHeight,
        png,
        pixelWidth: crop.width,
        pixelHeight: crop.height,
        questionNumber: questionFollowedBy(entry.pageIndex, found.box.top / entry.workHeight, markers),
        confident: found.confident,
        foundByInk: found.foundByInk,
        foundByModel: found.foundByModel,
      });
    }
  }
  return { diagrams, notes };
}

function pad(box: PixelBox, amount: number, width: number, height: number): PixelBox {
  return {
    left: Math.max(0, Math.floor(box.left - amount)),
    top: Math.max(0, Math.floor(box.top - amount)),
    right: Math.min(width, Math.ceil(box.right + amount)),
    bottom: Math.min(height, Math.ceil(box.bottom + amount)),
  };
}
