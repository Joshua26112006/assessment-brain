import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectPaperFigures, questionFollowedBy } from "@/lib/figures/paperFigures";
import { groupIntoLines } from "@/lib/figures/pdfPages";

describe("questionFollowedBy", () => {
  const markers = [
    { questionNumber: 1, page: 0, top: 100 },
    { questionNumber: 2, page: 0, top: 500 },
    { questionNumber: 3, page: 1, top: 80 },
  ];

  it("is the latest question marker above the figure on the same page", () => {
    expect(questionFollowedBy(0, 300, markers)).toBe(1);
    expect(questionFollowedBy(0, 600, markers)).toBe(2);
  });

  it("carries over from an earlier page when no marker has come yet on this one", () => {
    expect(questionFollowedBy(1, 40, markers)).toBe(2);
    expect(questionFollowedBy(1, 200, markers)).toBe(3);
  });

  it("is nothing for a figure above the first question", () => {
    expect(questionFollowedBy(0, 50, markers)).toBeNull();
    expect(questionFollowedBy(0, 50, [])).toBeNull();
  });
});

describe("groupIntoLines", () => {
  const run = (text: string, left: number, baseline: number) => ({
    text,
    baseline,
    fontHeight: 20,
    box: { left, right: left + 40, top: baseline - 19, bottom: baseline + 5 },
  });

  it("puts runs on one baseline into one line, left to right, and splits them into words", () => {
    const lines = groupIntoLines([run("(a)", 100, 500), run("Find the angle", 150, 501), run("2. State", 100, 540)]);
    expect(lines.map((line) => line.words.map((word) => word.text))).toEqual([["(a)", "Find", "the", "angle"], ["2.", "State"]]);
  });

  it("reads text from the PDF itself as fully sure", () => {
    expect(groupIntoLines([run("1.", 100, 100)])[0].words[0].confidence).toBe(100);
  });
});

describe("a real digital question paper", () => {
  const pdf = fs.readFileSync(path.join(__dirname, "fixtures", "paper.pdf"));
  const targets = [
    { questionNumber: 1, label: "1(a)" },
    { questionNumber: 2, label: "1(b)" },
    { questionNumber: 3, label: "2" },
    { questionNumber: 4, label: "3" },
    { questionNumber: 5, label: "4" },
    { questionNumber: 6, label: "5" },
  ];

  it("finds the figure, the table and the cell diagram, each with the question it follows", async () => {
    const result = await detectPaperFigures(pdf, targets);
    expect(result.pagesRead).toBe(1);
    expect(result.notes).toEqual([]);
    // The parallel-lines figure follows 1(a), the table follows 2, the cell follows 4; the draw-a-ray question has none.
    expect(result.figures.map((figure) => figure.questionNumber)).toEqual([1, 3, 5]);
  });

  it("crops each figure as a real picture of the right size, with its labels", async () => {
    const { figures } = await detectPaperFigures(pdf, targets);
    for (const figure of figures) {
      const meta = await sharp(figure.png).metadata();
      expect(meta.width).toBe(figure.pixelWidth);
      expect(meta.height).toBe(figure.pixelHeight);
      expect(figure.width).toBeGreaterThan(0.15);
      expect(figure.width).toBeLessThan(0.5);
      expect(figure.height).toBeGreaterThan(0.05);
    }
  });

  it("keeps a figure with no question when the numbers cannot be found, and says so", async () => {
    const result = await detectPaperFigures(pdf, [{ questionNumber: 1, label: "9(z)" }]);
    expect(result.figures.length).toBe(3);
    expect(result.figures.every((figure) => figure.questionNumber === null)).toBe(true);
    expect(result.notes.join(" ")).toContain("could not be located");
  });
});
