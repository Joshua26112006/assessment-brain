import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canStartQuestion, detectPaperFigures, questionFollowedBy } from "@/lib/figures/paperFigures";
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

describe("canStartQuestion", () => {
  const box = { left: 100, top: 500, right: 300, bottom: 520 };
  const words = (...texts: string[]) => texts.map((text) => ({ text }));

  it("is true for an ordinary line", () => {
    expect(canStartQuestion({ words: words("2.", "Study", "the", "table"), box }, [])).toBe(true);
  });

  it("is false for a row of numbers: that is data, not a question number", () => {
    expect(canStartQuestion({ words: words("1", "4"), box }, [])).toBe(false);
    expect(canStartQuestion({ words: words("3", "13.5", "%"), box }, [])).toBe(false);
  });

  it("is false for a line inside a drawing, and true for one just outside it", () => {
    const region = { left: 80, top: 480, right: 400, bottom: 560 };
    expect(canStartQuestion({ words: words("A"), box }, [region])).toBe(false);
    expect(canStartQuestion({ words: words("3.", "State"), box: { ...box, top: 600, bottom: 620 } }, [region])).toBe(true);
  });

  it("keeps a single bare number line, which could be a printed question number", () => {
    expect(canStartQuestion({ words: words("4"), box }, [])).toBe(true);
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

  it("finds the same figures when the questions are known only by their number, and is not fooled by the table's rows", async () => {
    // A flat paper: questions 1 to 5, no labels. The PDF prints "1. (a)" for the first, and the table below question 2
    // has rows that begin "1 4", "2 9", "3 13", which look like question numbers but are data.
    const flat = [1, 2, 3, 4, 5].map((questionNumber) => ({ questionNumber, label: null }));
    const result = await detectPaperFigures(pdf, flat);
    expect(result.notes).toEqual([]);
    expect(result.figures.map((figure) => figure.questionNumber)).toEqual([1, 2, 4]);
  });

  it("keeps a figure with no question when the numbers cannot be found, and says so", async () => {
    const result = await detectPaperFigures(pdf, [{ questionNumber: 1, label: "9(z)" }]);
    expect(result.figures.length).toBe(3);
    expect(result.figures.every((figure) => figure.questionNumber === null)).toBe(true);
    expect(result.notes.join(" ")).toContain("could not be located");
  });
});
