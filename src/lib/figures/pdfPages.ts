import type { PixelBox } from "@/lib/figures/inkRegions";
import type { LineWord, MarkerLine } from "@/lib/structuredCorrection/annotation/markers";

/**
 * Reads a digital PDF page by page: a picture of each page, and EXACTLY where its text is, from the PDF's own text
 * layer (no text detection, so no misreading). The picture is what figures are cropped from; the text positions tell the
 * figure finder what is writing and so is not drawing, and tell the marker search where each question starts.
 *
 * Server only. Never sees a model.
 */

export interface PdfLine extends MarkerLine {
  /** Where the line sits on the rendered page, in pixels. */
  box: PixelBox;
}

export interface RenderedPdfPage {
  pageNumber: number;
  /** Pixels of the rendered page. */
  width: number;
  height: number;
  /** The page as a PNG, in colour: figures are cropped from this. */
  png: Buffer;
  /** The page in grey, one byte per pixel, for finding drawings. */
  gray: Uint8Array;
  /** Every non-blank piece of text, in pixels. */
  textBoxes: PixelBox[];
  /** The text grouped into printed lines, top to bottom, ready for the marker search. */
  lines: PdfLine[];
}

export interface RenderOptions {
  /** 1 is 72 dots per inch. Default 3, sharp enough to read a label and crop a figure from. */
  scale?: number;
  /** Pages beyond this many are not read. Default 40. */
  maxPages?: number;
}

interface TextRun {
  text: string;
  box: PixelBox;
  baseline: number;
  fontHeight: number;
}

/** Groups text runs into printed lines: runs on the same baseline, left to right. */
export function groupIntoLines(runs: TextRun[]): PdfLine[] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.box.left - b.box.left);
  const lines: Array<{ runs: TextRun[]; baseline: number }> = [];
  for (const run of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.baseline - run.baseline) <= Math.max(2, run.fontHeight * 0.5)) {
      last.runs.push(run);
    } else {
      lines.push({ runs: [run], baseline: run.baseline });
    }
  }
  return lines.map((line) => {
    const ordered = [...line.runs].sort((a, b) => a.box.left - b.box.left);
    const words: LineWord[] = ordered.flatMap((run) =>
      run.text
        .split(/\s+/)
        .filter((word) => word.length > 0)
        // The PDF's own text is exact, so every word is as sure as a detector can be.
        .map((word) => ({ text: word, confidence: 100 })),
    );
    const box = ordered.map((run) => run.box).reduce((a, b) => ({
      left: Math.min(a.left, b.left),
      top: Math.min(a.top, b.top),
      right: Math.max(a.right, b.right),
      bottom: Math.max(a.bottom, b.bottom),
    }));
    return { words, box };
  });
}

export async function renderPdfPages(pdf: Buffer, options: RenderOptions = {}): Promise<RenderedPdfPage[]> {
  const scale = options.scale ?? 3;
  const maxPages = options.maxPages ?? 40;

  // Loaded here, not at the top of the file, so that a screen that never reads a PDF never loads the library.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const document = await task.promise;
  const pages: RenderedPdfPage[] = [];
  try {
    for (let number = 1; number <= Math.min(document.numPages, maxPages); number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;

      const rgba = context.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
      }

      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
        if (typeof item.str !== "string" || item.str.trim().length === 0 || !item.transform || typeof item.width !== "number") continue;
        // PDF space has y going up; the page picture has y going down.
        const [a, b, c, d, e, f] = viewport.transform as number[];
        const x = a * item.transform[4] + c * item.transform[5] + e;
        const y = b * item.transform[4] + d * item.transform[5] + f;
        const fontHeight = Math.hypot(item.transform[2], item.transform[3]) * scale;
        runs.push({
          text: item.str,
          baseline: y,
          fontHeight,
          box: { left: x, right: x + item.width * scale, top: y - fontHeight * 0.95, bottom: y + fontHeight * 0.25 },
        });
      }

      pages.push({
        pageNumber: number,
        width,
        height,
        png: canvas.toBuffer("image/png"),
        gray,
        textBoxes: runs.map((run) => run.box),
        lines: groupIntoLines(runs),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
