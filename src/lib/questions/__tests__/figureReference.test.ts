import { describe, expect, it } from "vitest";
import { referencesFigure } from "@/lib/questions/figureReference";

describe("referencesFigure", () => {
  it.each([
    "In the figure, AB is parallel to CD. Find angle x.",
    "Study the graph below and answer the questions.",
    "From the table given, find the mean.",
    "Refer to Fig. 2 and name the part labelled P.",
    "Using the circuit diagram shown, find the current.",
    "The adjoining figure shows a circle with centre O. Find the angle.",
    "Find the equivalent resistance as shown below.",
    "Observe the map and name the river.",
    "According to the chart, which month had the highest rainfall?",
  ])("flags a question that points at something shown: %s", (text) => {
    expect(referencesFigure(text)).toBe(true);
  });

  it.each([
    "Draw a diagram of the human heart and label four parts.",
    "Draw a ray diagram for a convex lens.",
    "Find the mean of 4, 8, 6, 10, 12.",
    "State Newton's second law of motion.",
    "Plot a graph of y = 2x + 1 for x from 0 to 4.",
    "Why is the periodic table arranged in groups and periods?",
    "Explain how a map projection distorts area.",
  ])("stays quiet when the student makes the figure or it is only mentioned: %s", (text) => {
    expect(referencesFigure(text)).toBe(false);
  });

  it("handles empty text", () => {
    expect(referencesFigure("")).toBe(false);
  });
});
