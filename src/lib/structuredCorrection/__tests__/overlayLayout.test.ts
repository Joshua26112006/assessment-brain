import { describe, expect, it } from "vitest";
import { buildOverlaySvg, chooseTotalPosition, markSpan } from "@/lib/structuredCorrection/annotation/overlay";

describe("markSpan", () => {
  it("puts the mark in the margin to the left of the question's own marker", () => {
    const { startX, endX } = markSpan({ markerLeft: 0.2 }, 1000, 30, 190);
    expect(endX).toBeLessThan(200); // ends before the marker starts (x = 200)
    expect(startX).toBeGreaterThanOrEqual(10);
    expect(endX - startX).toBeGreaterThanOrEqual(40);
  });

  it("falls back to the old span when the margin is too narrow to hold a mark", () => {
    expect(markSpan({ markerLeft: 0.04 }, 1000, 30, 190)).toEqual({ startX: 30, endX: 190 });
  });

  it("uses the old span when the marker's position is not known", () => {
    expect(markSpan({}, 1000, 30, 190)).toEqual({ startX: 30, endX: 190 });
  });
});

describe("chooseTotalPosition", () => {
  const base = { width: 1000, height: 1400, rx: 60, ry: 78, cy: 85 };

  it("prefers the top-right corner when it is free", () => {
    expect(chooseTotalPosition({ ...base, occupied: [] })).toEqual({ cx: 1000 - 60 - 40, cy: 85 });
  });

  it("moves away from a page header that runs across the top right", () => {
    const header = { left: 0.55, top: 0.02, width: 0.4, height: 0.03 };
    const chosen = chooseTotalPosition({ ...base, occupied: [header] });
    expect(chosen.cx).not.toBe(1000 - 60 - 40);
    expect(chosen.cx + 60 + 12).toBeLessThanOrEqual(550);
  });

  it("slides down the right edge when the whole top of the page is busy", () => {
    const busy = [{ left: 0.02, top: 0.0, width: 0.96, height: 0.12 }];
    const chosen = chooseTotalPosition({ ...base, occupied: busy });
    expect(chosen.cx).toBe(1000 - 60 - 40);
    expect(chosen.cy).toBeGreaterThan(85 + 78);
  });

  it("takes the least covered top spot when nowhere on the page is clear", () => {
    const everywhere = [{ left: 0, top: 0, width: 1, height: 0.7 }];
    expect(chooseTotalPosition({ ...base, occupied: everywhere }).cy).toBe(85);
  });
});

describe("buildOverlaySvg", () => {
  it("draws the total clear of the header and a tick before the marker", () => {
    const svg = buildOverlaySvg({
      width: 1000,
      height: 1400,
      questions: [{ markerTop: 0.2, markerLeft: 0.2, column: "full", awardedMarks: 2, maximumMarks: 2 }],
      mistakes: [],
      total: { awarded: 2, maximum: 2 },
      occupied: [{ left: 0.55, top: 0.02, width: 0.4, height: 0.03 }],
    });
    const tick = svg.match(/<polyline points="(\d+),/);
    expect(tick).not.toBeNull();
    expect(Number(tick![1])).toBeLessThan(200);
  });
});
