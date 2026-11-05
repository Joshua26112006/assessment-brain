import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { captionFor, figureContentParts, figureInstructions, MAX_FIGURES_PER_REQUEST, MODEL_PICTURE_SIDE } from "@/lib/figures/figureContent";

async function picture(width = 300, height = 200) {
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
}

describe("figureContentParts", () => {
  it("sends each picture with a line saying what it is, printed figures before model diagrams", async () => {
    const png = await picture();
    const parts = await figureContentParts([
      { role: "MODEL_DIAGRAM", png },
      { role: "QUESTION_FIGURE", png },
    ]);
    expect(parts.map((part) => part.type)).toEqual(["text", "image_url", "text", "image_url"]);
    expect((parts[0] as { text: string }).text).toBe(captionFor("QUESTION_FIGURE", 1));
    expect((parts[2] as { text: string }).text).toBe(captionFor("MODEL_DIAGRAM", 1));
    expect((parts[1] as { image_url: { url: string } }).image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("numbers figures and model diagrams separately", async () => {
    const png = await picture();
    const parts = await figureContentParts([
      { role: "QUESTION_FIGURE", png },
      { role: "QUESTION_FIGURE", png },
    ]);
    expect((parts[0] as { text: string }).text).toContain("FIGURE 1");
    expect((parts[2] as { text: string }).text).toContain("FIGURE 2");
  });

  it("reduces a huge picture to a size a model can use and keeps a small one as it is", async () => {
    const parts = await figureContentParts([
      { role: "QUESTION_FIGURE", png: await picture(4000, 1000) },
      { role: "QUESTION_FIGURE", png: await picture(200, 100) },
    ]);
    const size = async (part: unknown) => {
      const url = (part as { image_url: { url: string } }).image_url.url;
      return sharp(Buffer.from(url.split(",")[1], "base64")).metadata();
    };
    expect((await size(parts[1])).width).toBe(MODEL_PICTURE_SIDE);
    expect((await size(parts[3])).width).toBe(200);
  });

  it("sends no more than the limit, and nothing for no pictures", async () => {
    const png = await picture(50, 50);
    const many = Array.from({ length: MAX_FIGURES_PER_REQUEST + 3 }, () => ({ role: "QUESTION_FIGURE" as const, png }));
    expect((await figureContentParts(many)).filter((part) => part.type === "image_url")).toHaveLength(MAX_FIGURES_PER_REQUEST);
    expect(await figureContentParts([])).toEqual([]);
  });
});

describe("figureInstructions", () => {
  it("says nothing when there are no pictures, so the request is unchanged", () => {
    expect(figureInstructions([])).toBe("");
  });

  it("tells the model a referenced figure is not missing when one is attached", () => {
    const text = figureInstructions([{ role: "QUESTION_FIGURE", png: Buffer.alloc(0) }]);
    expect(text).toContain("NOT missing");
    expect(text).not.toContain("MODEL DIAGRAM");
  });

  it("asks for visible, one-feature-each criteria when there is a model diagram", () => {
    const text = figureInstructions([{ role: "MODEL_DIAGRAM", png: Buffer.alloc(0) }]);
    expect(text).toContain("visible features");
    expect(text).toContain("One feature per criterion");
  });
});
