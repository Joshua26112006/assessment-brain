import { describe, expect, it } from "vitest";
import { inkDiagramBoxes, overlapRatio, reconcileDiagrams, unionBox, withoutRuledLines } from "@/lib/figures/studentDiagrams";
import type { PixelBox } from "@/lib/figures/inkRegions";

const W = 1200;
const H = 1600;

function page(level = 245) {
  return new Uint8Array(W * H).fill(level);
}
function fill(gray: Uint8Array, box: PixelBox, value: number) {
  for (let y = box.top; y < box.bottom; y++) for (let x = box.left; x < box.right; x++) gray[y * W + x] = value;
}
/** A notebook: a faint line every 52 pixels across the whole width. */
function ruled(gray: Uint8Array) {
  for (let y = 120; y < H - 60; y += 52) fill(gray, { left: 60, top: y, right: W - 60, bottom: y + 2 }, 195);
}
function outline(gray: Uint8Array, box: PixelBox, value = 40, thickness = 4) {
  fill(gray, { left: box.left, top: box.top, right: box.right, bottom: box.top + thickness }, value);
  fill(gray, { left: box.left, top: box.bottom - thickness, right: box.right, bottom: box.bottom }, value);
  fill(gray, { left: box.left, top: box.top, right: box.left + thickness, bottom: box.bottom }, value);
  fill(gray, { left: box.right - thickness, top: box.top, right: box.right, bottom: box.bottom }, value);
}

describe("overlapRatio and unionBox", () => {
  const a = { left: 0, top: 0, right: 100, bottom: 100 };
  it("is 1 for the same box, 0 for boxes apart, and in between for a partial overlap", () => {
    expect(overlapRatio(a, a)).toBe(1);
    expect(overlapRatio(a, { left: 200, top: 0, right: 300, bottom: 100 })).toBe(0);
    expect(overlapRatio(a, { left: 50, top: 0, right: 150, bottom: 100 })).toBeCloseTo(1 / 3, 5);
  });
  it("covers both boxes", () => {
    expect(unionBox(a, { left: 50, top: 50, right: 150, bottom: 120 })).toEqual({ left: 0, top: 0, right: 150, bottom: 120 });
  });
});

describe("withoutRuledLines", () => {
  it("takes out the faint lines of a notebook and leaves dark ink alone", () => {
    const gray = page();
    ruled(gray);
    fill(gray, { left: 300, top: 600, right: 900, bottom: 604 }, 40); // a long dark axis, drawn in pen
    const cleaned = withoutRuledLines(gray, W, H);
    expect(cleaned[121 * W + 400]).toBe(245); // a ruled line is gone (inside its two pixels)
    expect(cleaned[601 * W + 500]).toBe(40); // the dark axis is untouched
  });

  it("keeps a short faint stroke: only long unbroken runs are rules", () => {
    const gray = page();
    fill(gray, { left: 400, top: 700, right: 480, bottom: 703 }, 195);
    expect(withoutRuledLines(gray, W, H)[701 * W + 440]).toBe(195);
  });

  it("does not change the page it was given", () => {
    const gray = page();
    ruled(gray);
    const before = gray[121 * W + 400];
    withoutRuledLines(gray, W, H);
    expect(gray[121 * W + 400]).toBe(before);
  });
});

describe("inkDiagramBoxes on a ruled notebook page", () => {
  it("finds a pen drawing and not the ruled lines or the handwriting", () => {
    const gray = page();
    ruled(gray);
    const writing = { left: 120, top: 150, right: 800, bottom: 190 };
    fill(gray, writing, 60); // handwriting, which the text detector reports as text
    outline(gray, { left: 300, top: 500, right: 700, bottom: 760 });
    const boxes = inkDiagramBoxes(gray, W, H, [writing]);
    expect(boxes).toHaveLength(1);
    expect(Math.abs(boxes[0].left - 300)).toBeLessThan(16);
    expect(Math.abs(boxes[0].bottom - 760)).toBeLessThan(16);
  });

  it("finds nothing on a page of writing and ruled lines", () => {
    const gray = page();
    ruled(gray);
    const writing = { left: 120, top: 150, right: 800, bottom: 190 };
    fill(gray, writing, 60);
    expect(inkDiagramBoxes(gray, W, H, [writing])).toEqual([]);
  });
});

describe("reconcileDiagrams", () => {
  const ink = { left: 100, top: 100, right: 300, bottom: 260 };

  it("is confident, and covers both boxes, when the two methods agree", () => {
    const model = { left: 90, top: 95, right: 320, bottom: 280 };
    const [found] = reconcileDiagrams([ink], [model]);
    expect(found).toMatchObject({ confident: true, foundByInk: true, foundByModel: true });
    expect(found.box).toEqual(unionBox(ink, model));
  });

  it("is not confident when only one method found it", () => {
    expect(reconcileDiagrams([ink], [])[0]).toMatchObject({ confident: false, foundByInk: true, foundByModel: false });
    expect(reconcileDiagrams([], [ink])[0]).toMatchObject({ confident: false, foundByInk: false, foundByModel: true });
  });

  it("is not confident when they found different places", () => {
    const elsewhere = { left: 600, top: 700, right: 900, bottom: 900 };
    const found = reconcileDiagrams([ink], [elsewhere]);
    expect(found).toHaveLength(2);
    expect(found.every((diagram) => !diagram.confident)).toBe(true);
  });

  it("is not confident for anything when the model could not be asked", () => {
    expect(reconcileDiagrams([ink], null).map((d) => d.confident)).toEqual([false]);
  });

  it("pairs each box with only one partner", () => {
    const found = reconcileDiagrams([ink, { ...ink, left: 110 }], [ink]);
    expect(found.filter((diagram) => diagram.confident)).toHaveLength(1);
    expect(found).toHaveLength(2);
  });

  it("lists diagrams top to bottom", () => {
    const low = { left: 100, top: 900, right: 300, bottom: 1000 };
    expect(reconcileDiagrams([low, ink], [low, ink]).map((d) => d.box.top)).toEqual([100, 900]);
  });
});
