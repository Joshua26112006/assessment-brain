import { describe, expect, it } from "vitest";
import type { Block } from "@aws-sdk/client-textract";
import { locateTextOnPage } from "@/lib/structuredCorrection/annotation/textractPage";

const word = (text: string, left: number, top: number): Block =>
  ({ BlockType: "WORD", Text: text, Geometry: { BoundingBox: { Left: left, Top: top, Width: 0.05, Height: 0.02 } } }) as Block;

/** "W = 2 x 10 x 5 = 120 J" laid out left to right on one line. */
const line = (texts: string[], top: number, startLeft = 0.1) => texts.map((t, i) => word(t, startLeft + i * 0.06, top));

describe("locateTextOnPage", () => {
  it("circles a value that occurs once", () => {
    const words = line(["W", "=", "2", "x", "10", "x", "5", "=", "120", "J"], 0.3);
    const box = locateTextOnPage(words, "120 J");
    expect(box).not.toBeNull();
    expect(box!.left).toBeCloseTo(0.1 + 8 * 0.06, 5);
  });

  it("does NOT circle a value that occurs more than once: it cannot know which line the finding is about", () => {
    const words = [...line(["W", "=", "120", "J"], 0.3), ...line(["Ans", "=", "120", "J"], 0.4)];
    expect(locateTextOnPage(words, "120 J")).toBeNull();
  });

  it("does not circle the restatement of the question in place of the working", () => {
    // The student copied "g = 10" into the working and then used it: two occurrences, so neither is circled.
    const words = [...line(["g", "=", "10"], 0.2), ...line(["W", "=", "mgh", "=", "2", "x", "10", "x", "5"], 0.3), ...line(["g", "=", "10"], 0.4)];
    expect(locateTextOnPage(words, "g = 10")).toBeNull();
  });

  it("finds nothing for text that is not there", () => {
    expect(locateTextOnPage(line(["W", "=", "100", "J"], 0.3), "999")).toBeNull();
  });

  it("finds nothing for an empty quote", () => {
    expect(locateTextOnPage(line(["W", "=", "100"], 0.3), "  ")).toBeNull();
  });

  it("still joins a token the detector split across words", () => {
    const words = line(["ans", "15", "/", "12"], 0.3);
    expect(locateTextOnPage(words, "15/12")).not.toBeNull();
  });
});
