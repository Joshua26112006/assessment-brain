import { describe, expect, it } from "vitest";
import { backgroundLevel, findInkRegions, type PixelBox } from "@/lib/figures/inkRegions";

const W = 600;
const H = 800;

function page(level = 255) {
  return new Uint8Array(W * H).fill(level);
}

function fill(gray: Uint8Array, box: PixelBox, value = 0) {
  for (let y = box.top; y < box.bottom; y++) for (let x = box.left; x < box.right; x++) gray[y * W + x] = value;
}

/** A rectangle drawn as an outline, the way a figure is drawn. */
function outline(gray: Uint8Array, box: PixelBox, thickness = 3) {
  fill(gray, { left: box.left, top: box.top, right: box.right, bottom: box.top + thickness });
  fill(gray, { left: box.left, top: box.bottom - thickness, right: box.right, bottom: box.bottom });
  fill(gray, { left: box.left, top: box.top, right: box.left + thickness, bottom: box.bottom });
  fill(gray, { left: box.right - thickness, top: box.top, right: box.right, bottom: box.bottom });
}

const near = (value: number, expected: number, within = 8) => Math.abs(value - expected) <= within;

describe("findInkRegions", () => {
  it("finds a drawing", () => {
    const gray = page();
    outline(gray, { left: 100, top: 200, right: 300, bottom: 350 });
    const regions = findInkRegions(gray, W, H, []);
    expect(regions).toHaveLength(1);
    expect(near(regions[0].left, 100)).toBe(true);
    expect(near(regions[0].top, 200)).toBe(true);
    expect(near(regions[0].right, 300)).toBe(true);
    expect(near(regions[0].bottom, 350)).toBe(true);
  });

  it("ignores ink that is inside a text box: that is writing, not drawing", () => {
    const gray = page();
    const text = { left: 50, top: 100, right: 400, bottom: 130 };
    fill(gray, text);
    expect(findInkRegions(gray, W, H, [text])).toEqual([]);
  });

  it("ignores a rule or underline, and a speck", () => {
    const gray = page();
    fill(gray, { left: 50, top: 400, right: 550, bottom: 403 });
    fill(gray, { left: 300, top: 600, right: 306, bottom: 606 });
    expect(findInkRegions(gray, W, H, [])).toEqual([]);
  });

  it("brings a small label beside a drawing into its region", () => {
    const gray = page();
    outline(gray, { left: 100, top: 200, right: 300, bottom: 350 });
    const label = { left: 305, top: 190, right: 325, bottom: 208 };
    fill(gray, label); // the label's own ink, which is text and so is left out of the drawing
    const regions = findInkRegions(gray, W, H, [label]);
    expect(regions).toHaveLength(1);
    expect(regions[0].right).toBeGreaterThanOrEqual(325);
    expect(regions[0].top).toBeLessThanOrEqual(190);
  });

  it("does not take a whole sentence next to a drawing for a label", () => {
    const gray = page();
    outline(gray, { left: 100, top: 200, right: 300, bottom: 350 });
    const sentence = { left: 100, top: 360, right: 560, bottom: 378 };
    fill(gray, sentence);
    const regions = findInkRegions(gray, W, H, [sentence]);
    expect(regions).toHaveLength(1);
    expect(regions[0].bottom).toBeLessThan(370);
  });

  it("keeps two separate drawings separate, top to bottom", () => {
    const gray = page();
    outline(gray, { left: 100, top: 500, right: 250, bottom: 620 });
    outline(gray, { left: 100, top: 100, right: 250, bottom: 220 });
    const regions = findInkRegions(gray, W, H, []);
    expect(regions).toHaveLength(2);
    expect(regions[0].top).toBeLessThan(regions[1].top);
  });

  it("joins the strokes of one drawing that sit close together", () => {
    const gray = page();
    outline(gray, { left: 100, top: 200, right: 200, bottom: 300 });
    outline(gray, { left: 210, top: 200, right: 310, bottom: 300 });
    expect(findInkRegions(gray, W, H, [])).toHaveLength(1);
  });

  it("works on a grey photographed page: ink is judged against the paper, not against white", () => {
    const gray = page(200);
    outline(gray, { left: 100, top: 200, right: 300, bottom: 350 });
    // the same page without the drawing is found to be empty
    expect(findInkRegions(gray, W, H, [])).toHaveLength(1);
    expect(findInkRegions(page(200), W, H, [])).toEqual([]);
  });

  it("ignores a frame drawn around the whole page", () => {
    const gray = page();
    outline(gray, { left: 5, top: 5, right: W - 5, bottom: H - 5 }, 4);
    expect(findInkRegions(gray, W, H, [])).toEqual([]);
  });

  it("returns nothing for a blank page or bad input", () => {
    expect(findInkRegions(page(), W, H, [])).toEqual([]);
    expect(findInkRegions(new Uint8Array(10), W, H, [])).toEqual([]);
    expect(findInkRegions(page(), 0, 0, [])).toEqual([]);
  });
});

describe("backgroundLevel", () => {
  it("is the paper, not the ink", () => {
    const gray = page(240);
    fill(gray, { left: 0, top: 0, right: 200, bottom: 200 }, 10);
    expect(backgroundLevel(gray)).toBe(240);
  });
});
