import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectStudentDiagrams, type DetectionServices } from "@/lib/figures/studentDiagramDetection";

import type { PageAnalysis } from "@/lib/structuredCorrection/annotation/textractPage";

/**
 * A real drawn notebook page, 1240 by 1754: faint ruled lines, a header, "3. C" crossed out then "B", a "4. (ray
 * diagram)" label and a lens-and-rays drawing below it (about x 250 to 950, y 440 to 680).
 */
const page = fs.readFileSync(path.join(__dirname, "fixtures", "student-page.png"));
const W = 1240;
const H = 1754;

const word = (left: number, top: number, width: number, height: number) => ({
  Geometry: { BoundingBox: { Left: left / W, Top: top / H, Width: width / W, Height: height / H } },
});
const analysisOf = (markers: Array<[number, number]>): PageAnalysis => ({
  markers: new Map(markers.map(([question, top]) => [question, { bbox: { left: 100 / W, top: top / H, width: 40 / W, height: 40 / H }, column: "full" as const }])),
  readingOrderWords: [
    word(130, 36, 560, 44), // the header
    word(124, 136, 110, 44), // "3. C"
    word(124, 188, 40, 44), // "B"
    word(124, 326, 420, 44), // "4. (ray diagram)"
  ] as never,
});

const lens = { left: 250, top: 440, right: 960, bottom: 690 };

function services(overrides: Partial<DetectionServices> = {}): DetectionServices {
  return {
    analyse: async () => analysisOf([[1, 136], [2, 326]]),
    // The model's box is a little looser than the ink, as a model's usually is; the scale is the picture it was shown.
    locate: async (_jpeg, width, height) => [
      { left: Math.round((lens.left - 20) * (width / W)), top: Math.round((lens.top - 15) * (height / H)), right: Math.round((lens.right + 20) * (width / W)), bottom: Math.round((lens.bottom + 15) * (height / H)) },
    ],
    ...overrides,
  };
}

describe("detectStudentDiagrams on a real notebook page", () => {
  it("finds the drawing, is confident because both methods agree, and ties it to question 2", async () => {
    const { diagrams, notes } = await detectStudentDiagrams([{ pageNumber: 1, buffer: page }], [{ questionNumber: 1 }, { questionNumber: 2 }], services());
    expect(notes).toEqual([]);
    expect(diagrams).toHaveLength(1);
    const [diagram] = diagrams;
    expect(diagram).toMatchObject({ pageNumber: 1, confident: true, foundByInk: true, foundByModel: true, questionNumber: 2 });
    // It covers the drawing and is not stretched along the ruled lines.
    expect(diagram.left * W).toBeLessThan(lens.left);
    expect(diagram.left * W).toBeGreaterThan(150);
    expect((diagram.left + diagram.width) * W).toBeGreaterThan(lens.right);
    expect((diagram.left + diagram.width) * W).toBeLessThan(1100);
  });

  it("crops the real picture at the page's own resolution", async () => {
    const { diagrams } = await detectStudentDiagrams([{ pageNumber: 1, buffer: page }], [{ questionNumber: 2 }], services());
    const meta = await sharp(diagrams[0].png).metadata();
    expect(meta.width).toBe(diagrams[0].pixelWidth);
    expect(meta.height).toBe(diagrams[0].pixelHeight);
    expect(meta.width).toBeGreaterThan(600);
  });

  it("is not confident when the model sees nothing there", async () => {
    const { diagrams } = await detectStudentDiagrams([{ pageNumber: 1, buffer: page }], [{ questionNumber: 2 }], services({ locate: async () => [] }));
    expect(diagrams.some((d) => d.foundByInk && !d.foundByModel && !d.confident)).toBe(true);
    expect(diagrams.every((d) => !d.confident)).toBe(true);
  });

  it("is not confident, and says so, when the model cannot be asked", async () => {
    const { diagrams, notes } = await detectStudentDiagrams([{ pageNumber: 1, buffer: page }], [{ questionNumber: 2 }], services({ locate: async () => null }));
    expect(diagrams.every((d) => !d.confident)).toBe(true);
    expect(notes.join(" ")).toContain("could not be asked");
  });

  it("trusts no diagram, and says so, when the text detector is unavailable", async () => {
    const { diagrams, notes } = await detectStudentDiagrams(
      [{ pageNumber: 1, buffer: page }],
      [{ questionNumber: 2 }],
      services({ analyse: async () => { throw new Error("no credentials"); } }),
    );
    expect(diagrams.every((d) => !d.confident)).toBe(true);
    expect(diagrams.every((d) => !d.foundByInk)).toBe(true);
    expect(notes.join(" ")).toContain("writing could not be told from drawing");
  });

  it("finds nothing, and does not ask the model, on a page with no drawing", async () => {
    // The same page with the drawing painted out.
    const blank = await sharp(page)
      .composite([{ input: { create: { width: 760, height: 280, channels: 3, background: { r: 250, g: 248, b: 240 } } }, left: 240, top: 430 }])
      .png()
      .toBuffer();
    let asked = 0;
    const { diagrams } = await detectStudentDiagrams([{ pageNumber: 1, buffer: blank }], [{ questionNumber: 2 }], services({ locate: async () => { asked++; return []; } }));
    expect(diagrams).toEqual([]);
    expect(asked).toBe(0);
  });

  it("asks the model about a page the reader said has a drawing even when no ink was found", async () => {
    const blank = await sharp(page)
      .composite([{ input: { create: { width: 760, height: 280, channels: 3, background: { r: 250, g: 248, b: 240 } } }, left: 240, top: 430 }])
      .png()
      .toBuffer();
    let asked = 0;
    await detectStudentDiagrams([{ pageNumber: 1, buffer: blank }], [{ questionNumber: 2 }], services({ locate: async () => { asked++; return []; } }), { flaggedPages: new Set([1]) });
    expect(asked).toBe(1);
  });
});
