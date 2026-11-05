import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
vi.mock("@/lib/ai/callStructured", () => ({ callStructuredAiWithContent: (...args: unknown[]) => ask(...args) }));

import { locateDiagramsWithModel, parseDiagramBoxes } from "@/lib/figures/modelDiagrams";

describe("locateDiagramsWithModel", () => {
  beforeEach(() => {
    ask.mockReset();
    ask.mockImplementation(async () => ({}));
  });

  it("returns the boxes the model gives, in pixels", async () => {
    ask.mockResolvedValueOnce({ diagrams: [{ box_2d: [100, 100, 500, 500] }] });
    expect(await locateDiagramsWithModel(Buffer.from("x"), 1000, 1000)).toEqual([{ left: 100, top: 100, right: 500, bottom: 500 }]);
  });

  it("asks once more after a reply it cannot understand", async () => {
    ask.mockResolvedValueOnce({ nonsense: true }).mockResolvedValueOnce({ diagrams: [] });
    expect(await locateDiagramsWithModel(Buffer.from("x"), 1000, 1000)).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("is null, never a guess, when the model cannot be asked at all", async () => {
    ask.mockImplementation(async () => {
      throw new Error("network");
    });
    expect(await locateDiagramsWithModel(Buffer.from("x"), 1000, 1000)).toBeNull();
  });
});

describe("parseDiagramBoxes", () => {
  it("turns the model's 0 to 1000 boxes into pixels, in [ymin, xmin, ymax, xmax] order", () => {
    const boxes = parseDiagramBoxes({ diagrams: [{ box_2d: [100, 200, 500, 800] }] }, 1000, 2000);
    expect(boxes).toEqual([{ left: 200, top: 200, right: 800, bottom: 1000 }]);
  });

  it("is an empty list, not a failure, when the model says there is no picture", () => {
    expect(parseDiagramBoxes({ diagrams: [] }, 800, 1000)).toEqual([]);
  });

  it("is null for a reply that is not in the expected shape", () => {
    expect(parseDiagramBoxes(null, 800, 1000)).toBeNull();
    expect(parseDiagramBoxes({ boxes: [] }, 800, 1000)).toBeNull();
    expect(parseDiagramBoxes("diagrams", 800, 1000)).toBeNull();
  });

  it("skips a malformed box and one too small to be a picture, and keeps the rest", () => {
    const boxes = parseDiagramBoxes(
      { diagrams: [{ box_2d: [1, 2, 3] }, { box_2d: ["a", 1, 2, 3] }, { box_2d: [100, 100, 110, 400] }, { box_2d: [100, 100, 600, 600] }, "x"] },
      1000,
      1000,
    );
    expect(boxes).toEqual([{ left: 100, top: 100, right: 600, bottom: 600 }]);
  });

  it("keeps a box inside the page", () => {
    const [box] = parseDiagramBoxes({ diagrams: [{ box_2d: [-50, -50, 1200, 1200] }] }, 500, 500) ?? [];
    expect(box).toEqual({ left: 0, top: 0, right: 500, bottom: 500 });
  });
});
