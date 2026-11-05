/**
 * Finds where the drawings are on a page: marks on the paper that are not text.
 *
 * It works the same way for a rendered digital PDF and for a photographed answer sheet, because it needs only two
 * things: the page as a grayscale picture, and where the TEXT is (exact positions from the PDF's own text layer, or the
 * words a text detector read on a scan). Take the text away and what is left is drawing: lines, curves, shaded shapes,
 * table grids. Nearby marks are joined into one region, small labels beside a region (A, B, P, 30 cm) are brought back
 * into it, and rules, underlines and specks are thrown away.
 *
 * It judges nothing about what a drawing means. It only says "something is drawn here". Pure: pixels in, boxes out.
 */

/** A box in pixels: left and top are inside it, right and bottom are the first pixel outside. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface InkOptions {
  /** How much darker than the page background a pixel must be to count as ink. Default 40 (of 255). */
  contrast?: number;
  /** Work on blocks of this many pixels a side, which also sets how fine a stroke can be missed. Default 4. */
  block?: number;
  /** Marks closer together than this many pixels belong to one drawing. Default 24. */
  joinGap?: number;
  /** A region smaller than this share of the page is a speck, not a drawing. Default 0.004. */
  minAreaShare?: number;
  /** A region thinner than this many pixels is a rule or underline, not a drawing. Default 8. */
  minThickness?: number;
  /** A region larger than this share of the page is a frame or a shadow, not a drawing. Default 0.85. */
  maxAreaShare?: number;
  /** A text box wider than this share of the page width is a sentence, never a label. Default 0.2. */
  maxLabelWidthShare?: number;
  /** A text box taller than this share of the page height is not a label. Default 0.03. */
  maxLabelHeightShare?: number;
}

const DEFAULTS: Required<InkOptions> = {
  contrast: 40,
  block: 4,
  joinGap: 24,
  minAreaShare: 0.004,
  minThickness: 8,
  maxAreaShare: 0.85,
  maxLabelWidthShare: 0.2,
  maxLabelHeightShare: 0.03,
};

/** The brightness most of the page has: the paper. A high percentile, so that drawings and text do not pull it down. */
export function backgroundLevel(gray: Uint8Array): number {
  if (gray.length === 0) return 255;
  const histogram = new Uint32Array(256);
  // Sampling every 7th pixel is plenty for a percentile and keeps a large scan fast.
  for (let i = 0; i < gray.length; i += 7) histogram[gray[i]]++;
  let total = 0;
  for (const count of histogram) total += count;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += histogram[level];
    if (seen >= total * 0.8) return level;
  }
  return 255;
}

function overlaps(a: PixelBox, b: PixelBox, gap: number): boolean {
  return a.left - gap < b.right && b.left - gap < a.right && a.top - gap < b.bottom && b.top - gap < a.bottom;
}

function union(a: PixelBox, b: PixelBox): PixelBox {
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

/**
 * The drawings on a page, top to bottom.
 *
 * @param gray      one byte per pixel, row by row, 0 black to 255 white
 * @param textBoxes where the text is, in the same pixels; blank boxes are ignored
 */
export function findInkRegions(gray: Uint8Array, width: number, height: number, textBoxes: PixelBox[], options: InkOptions = {}): PixelBox[] {
  const o = { ...DEFAULTS, ...options };
  if (width <= 0 || height <= 0 || gray.length < width * height) return [];

  const background = backgroundLevel(gray);
  const threshold = background - o.contrast;

  // 1. Which blocks hold ink, with the text itself left out (a little inflated, to cover the whole of each glyph).
  const gridW = Math.ceil(width / o.block);
  const gridH = Math.ceil(height / o.block);
  const ink = new Uint8Array(gridW * gridH);
  // Index the text boxes by block row so the scan stays fast on a full page.
  const rows: PixelBox[][] = Array.from({ length: gridH }, () => []);
  for (const box of textBoxes) {
    const first = Math.max(0, Math.floor((box.top - 2) / o.block));
    const last = Math.min(gridH - 1, Math.floor((box.bottom + 2) / o.block));
    for (let row = first; row <= last; row++) rows[row].push(box);
  }
  for (let by = 0; by < gridH; by++) {
    const rowBoxes = rows[by];
    for (let bx = 0; bx < gridW; bx++) {
      let found = false;
      for (let y = by * o.block; y < Math.min(height, (by + 1) * o.block) && !found; y++) {
        for (let x = bx * o.block; x < Math.min(width, (bx + 1) * o.block); x++) {
          if (gray[y * width + x] >= threshold) continue;
          if (rowBoxes.some((box) => x >= box.left - 2 && x < box.right + 2 && y >= box.top - 2 && y < box.bottom + 2)) continue;
          found = true;
          break;
        }
      }
      if (found) ink[by * gridW + bx] = 1;
    }
  }

  // 2. Join marks that are close: dilate, then label connected pieces and keep the box of what the ink itself covered.
  const radius = Math.max(1, Math.round(o.joinGap / o.block / 2));
  const joined = new Uint8Array(gridW * gridH);
  for (let by = 0; by < gridH; by++) {
    for (let bx = 0; bx < gridW; bx++) {
      if (!ink[by * gridW + bx]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = by + dy;
          const nx = bx + dx;
          if (ny >= 0 && ny < gridH && nx >= 0 && nx < gridW) joined[ny * gridW + nx] = 1;
        }
      }
    }
  }

  const seen = new Uint8Array(gridW * gridH);
  const regions: PixelBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < joined.length; start++) {
    if (!joined[start] || seen[start]) continue;
    let box: PixelBox | null = null;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const cy = Math.floor(cell / gridW);
      const cx = cell % gridW;
      if (ink[cell]) {
        const cellBox = { left: cx * o.block, top: cy * o.block, right: Math.min(width, (cx + 1) * o.block), bottom: Math.min(height, (cy + 1) * o.block) };
        box = box ? union(box, cellBox) : cellBox;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const next = ny * gridW + nx;
        if (joined[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (box) regions.push(box);
  }

  // 3. Bring in small labels that sit beside a drawing, then merge regions the labels join.
  const labels = textBoxes.filter(
    (box) =>
      box.right > box.left &&
      box.bottom > box.top &&
      box.right - box.left <= o.maxLabelWidthShare * width &&
      box.bottom - box.top <= o.maxLabelHeightShare * height,
  );
  let grown = regions.map((region) => ({ ...region }));
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < grown.length; i++) {
      for (const label of labels) {
        if (overlaps(grown[i], label, 10) && !(label.left >= grown[i].left && label.right <= grown[i].right && label.top >= grown[i].top && label.bottom <= grown[i].bottom)) {
          grown[i] = union(grown[i], label);
          changed = true;
        }
      }
    }
    for (let i = 0; i < grown.length; i++) {
      for (let j = grown.length - 1; j > i; j--) {
        if (overlaps(grown[i], grown[j], 0)) {
          grown[i] = union(grown[i], grown[j]);
          grown.splice(j, 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 4. Throw away what is not a drawing: specks, rules and underlines, and page-sized frames.
  const pageArea = width * height;
  grown = grown.filter((box) => {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    if (Math.min(w, h) < o.minThickness) return false;
    const share = (w * h) / pageArea;
    return share >= o.minAreaShare && share <= o.maxAreaShare;
  });

  return grown.sort((a, b) => a.top - b.top || a.left - b.left);
}
