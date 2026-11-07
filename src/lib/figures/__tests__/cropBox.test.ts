import { describe, expect, it } from "vitest";
import { boxFromDrag, MIN_CROP_SIDE, validateCropBox } from "@/lib/figures/cropBox";

describe("validateCropBox", () => {
  it("accepts a real region, and numbers that arrive as text from a form", () => {
    expect(validateCropBox({ left: 0.1, top: 0.2, width: 0.5, height: 0.3 })).toEqual({ ok: true, box: { left: 0.1, top: 0.2, width: 0.5, height: 0.3 } });
    expect(validateCropBox({ left: "0.1", top: "0.2", width: "0.5", height: "0.3" }).ok).toBe(true);
  });

  it("keeps a box that overshoots the page inside it", () => {
    const result = validateCropBox({ left: 0.6, top: 0.7, width: 0.6, height: 0.6 });
    expect(result).toEqual({ ok: true, box: { left: 0.6, top: 0.7, width: expect.closeTo(0.4, 6), height: expect.closeTo(0.3, 6) } });
  });

  it("refuses a missing or non-numeric value", () => {
    expect(validateCropBox({ left: "", top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
    expect(validateCropBox({ left: "a", top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
    expect(validateCropBox({ left: NaN, top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
    expect(validateCropBox({ left: undefined, top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
  });

  it("refuses a box outside the page", () => {
    expect(validateCropBox({ left: -0.1, top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
    expect(validateCropBox({ left: 1, top: 0, width: 0.5, height: 0.5 }).ok).toBe(false);
  });

  it("refuses a stray click: a box smaller than the minimum on either side", () => {
    expect(validateCropBox({ left: 0.1, top: 0.1, width: MIN_CROP_SIDE / 2, height: 0.5 }).ok).toBe(false);
    expect(validateCropBox({ left: 0.1, top: 0.1, width: 0.5, height: MIN_CROP_SIDE / 2 }).ok).toBe(false);
    expect(validateCropBox({ left: 0.99, top: 0.1, width: 0.5, height: 0.5 }).ok).toBe(false);
  });
});

describe("boxFromDrag", () => {
  it("is the box between the two corners, whichever way the drag went", () => {
    const expected = { left: 0.2, top: 0.3, width: expect.closeTo(0.4, 6), height: expect.closeTo(0.2, 6) };
    expect(boxFromDrag({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 })).toEqual(expected);
    expect(boxFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 })).toEqual(expected);
    expect(boxFromDrag({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.3 })).toEqual(expected);
  });

  it("keeps a drag that leaves the page inside the page", () => {
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 1.4, y: -0.2 })).toEqual({ left: 0.5, top: 0, width: 0.5, height: 0.5 });
  });

  it("is an empty box for a click with no drag, which validation then refuses", () => {
    const box = boxFromDrag({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 });
    expect(box.width).toBe(0);
    expect(validateCropBox(box).ok).toBe(false);
  });
});
