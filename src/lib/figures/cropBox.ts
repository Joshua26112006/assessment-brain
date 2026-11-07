/**
 * A crop box a teacher draws on a page, as 0 to 1 fractions of the page (left, top, width, height). Pure: no page, no
 * screen, so both the drawing tool and the server use the same rules.
 */

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest box a teacher can draw: 3% of the page in each direction. Anything smaller is a stray click. */
export const MIN_CROP_SIDE = 0.03;

export type CropBoxResult = { ok: true; box: CropBox } | { ok: false; message: string };

/** A box checked and kept inside the page. Refuses anything that is not a real, usable region. */
export function validateCropBox(input: { left: unknown; top: unknown; width: unknown; height: unknown }): CropBoxResult {
  const values = [input.left, input.top, input.width, input.height].map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v));
  if (!values.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return { ok: false, message: "Draw a box around the diagram first." };
  const [left, top, width, height] = values;
  if (left < 0 || top < 0 || left >= 1 || top >= 1) return { ok: false, message: "The box is outside the page." };
  // A little overshoot from rounding is fine; the box is kept inside the page.
  const right = Math.min(1, left + width);
  const bottom = Math.min(1, top + height);
  if (right - left < MIN_CROP_SIDE || bottom - top < MIN_CROP_SIDE) return { ok: false, message: "That box is too small to be a diagram. Draw it around the whole drawing." };
  return { ok: true, box: { left, top, width: right - left, height: bottom - top } };
}

/** The box between where a drag began and where it is now, whichever way it was dragged, kept inside the page. */
export function boxFromDrag(start: { x: number; y: number }, now: { x: number; y: number }): CropBox {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(start.x, now.x));
  const x2 = clamp(Math.max(start.x, now.x));
  const y1 = clamp(Math.min(start.y, now.y));
  const y2 = clamp(Math.max(start.y, now.y));
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
}
