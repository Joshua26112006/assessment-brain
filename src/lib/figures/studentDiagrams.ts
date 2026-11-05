import { backgroundLevel, findInkRegions, type PixelBox } from "@/lib/figures/inkRegions";

/**
 * Finding a hand-drawn diagram on a student's sheet by TWO independent methods, so that neither is trusted alone:
 *
 *   1. Ink: marks on the page that are not writing (inkRegions.ts), with the notebook's ruled lines taken out first.
 *   2. The reader model's own opinion of where the drawings are (see modelDiagrams.ts).
 *
 * A diagram is "confident" only when both found it and agree on where it is. Anything else is kept, with its crop,
 * but marked not confident: the answer is then flagged for the teacher, who can see the crop and redraw it.
 *
 * Pure: pixels and boxes in, boxes out.
 */

/** Intersection over union of two boxes: 1 for the same box, 0 for boxes that do not touch. */
export function overlapRatio(a: PixelBox, b: PixelBox): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  return intersection / (areaA + areaB - intersection);
}

export function unionBox(a: PixelBox, b: PixelBox): PixelBox {
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

/**
 * The lines a notebook is printed with, taken out of a grey page. They are faint and run most of the page width, so a
 * long unbroken run of faint ink is a rule, not a drawing. Dark ink is never touched, so a ruler-straight axis drawn in
 * pen survives. Returns a copy; the page is not changed.
 *
 * @param faintBand ink this much darker than the paper, but not more, counts as faint: [contrast, contrast + faintBand)
 */
export function withoutRuledLines(
  gray: Uint8Array,
  width: number,
  height: number,
  options: { contrast?: number; faintBand?: number; minRunShare?: number } = {},
): Uint8Array {
  const contrast = options.contrast ?? 40;
  const faintBand = options.faintBand ?? 35;
  const minRun = Math.max(8, Math.round((options.minRunShare ?? 0.3) * width));
  const background = backgroundLevel(gray);
  const darkest = background - contrast; // darker than this is ink
  const faintest = background - contrast - faintBand; // but not darker than this: faint
  const cleaned = new Uint8Array(gray);

  // A rule runs on UNDER dark ink: where a drawing or a word crosses it, the rule carries on either side. So a run is
  // faint pixels, bridged across dark ink and across small gaps, and only the faint pixels in it are taken out.
  const gapAllowed = Math.max(3, Math.round(width / 200));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let runStart = -1;
    let lastFaint = -1;
    let gap = 0;
    const closeRun = () => {
      if (runStart >= 0 && lastFaint - runStart + 1 >= minRun) {
        for (let k = runStart; k <= lastFaint; k++) {
          const value = gray[row + k];
          if (value < darkest && value >= faintest) cleaned[row + k] = background;
        }
      }
      runStart = -1;
      lastFaint = -1;
      gap = 0;
    };
    for (let x = 0; x < width; x++) {
      const value = gray[row + x];
      if (value < darkest && value >= faintest) {
        if (runStart < 0) runStart = x;
        lastFaint = x;
        gap = 0;
      } else if (value < faintest) {
        // Dark ink: part of whatever crosses the rule, so the run carries on.
        gap = 0;
      } else if (runStart >= 0 && ++gap > gapAllowed) {
        closeRun();
      }
    }
    closeRun();
  }
  return cleaned;
}

/** Where the drawings on a student's page are, by ink alone: not writing, not the ruled lines, not specks. */
export function inkDiagramBoxes(gray: Uint8Array, width: number, height: number, textBoxes: PixelBox[]): PixelBox[] {
  // The options were tuned at 144 dpi for a letter page (about 1200 pixels across): scale them to this page.
  const factor = width / 1200;
  return findInkRegions(withoutRuledLines(gray, width, height), width, height, textBoxes, {
    joinGap: 24 * factor,
    minThickness: 14 * factor,
    minAreaShare: 0.006,
  });
}

export interface FoundDiagram {
  box: PixelBox;
  /** Both methods found it and agree where it is. */
  confident: boolean;
  foundByInk: boolean;
  foundByModel: boolean;
}

/** The overlap two boxes need to count as the same diagram. */
export const AGREEMENT = 0.5;

/**
 * Sets the two methods' answers against each other. A pair that overlap enough are one diagram, drawn as the box
 * that covers both. A box only one method found is kept but not confident. If the model could not be asked
 * (`modelBoxes` is null) nothing is confident.
 */
export function reconcileDiagrams(inkBoxes: PixelBox[], modelBoxes: PixelBox[] | null): FoundDiagram[] {
  const found: FoundDiagram[] = [];
  const unmatchedModel = modelBoxes ? [...modelBoxes] : [];

  for (const ink of inkBoxes) {
    let bestIndex = -1;
    let best = 0;
    unmatchedModel.forEach((model, index) => {
      const ratio = overlapRatio(ink, model);
      if (ratio > best) {
        best = ratio;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && best >= AGREEMENT) {
      const [model] = unmatchedModel.splice(bestIndex, 1);
      found.push({ box: unionBox(ink, model), confident: true, foundByInk: true, foundByModel: true });
    } else {
      found.push({ box: ink, confident: false, foundByInk: true, foundByModel: false });
    }
  }
  for (const model of unmatchedModel) found.push({ box: model, confident: false, foundByInk: false, foundByModel: true });

  return found.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
}
