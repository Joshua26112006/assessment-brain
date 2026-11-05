import { describe, expect, it } from "vitest";
import { locateMarkers, type MarkerLine } from "@/lib/structuredCorrection/annotation/markers";

const line = (text: string, confidence = 95): MarkerLine => ({
  words: text.split(/\s+/).map((word) => ({ text: word, confidence })),
});
const at = (lines: MarkerLine[], questionNumber: number, label?: string) =>
  locateMarkers(lines, [{ questionNumber, label }]).get(questionNumber);

describe("locateMarkers — a question known only by its number, printed with its parts", () => {
  it("starts where the first part starts, when there is no plain line for the number", () => {
    const lines = [line("1(a) In the figure find x"), line("(b) State the property"), line("2. Study the table")];
    const found = locateMarkers(lines, [{ questionNumber: 1 }, { questionNumber: 2 }]);
    expect([...found]).toEqual([[1, 0], [2, 2]]);
  });

  it("still prefers a plain line for the number when there is one", () => {
    const lines = [line("1. Answer the following"), line("(a) Find x"), line("(b) Find y")];
    expect(at(lines, 1)).toBe(0);
  });

  it("does not take a later part (b) for the whole question", () => {
    expect(at([line("1(b) only the second part is printed")], 1)).toBeUndefined();
  });
});

describe("locateMarkers — a flat paper keeps working exactly as before", () => {
  const sheet = [line("Find the mode of the data"), line("1. Find the mode"), line("Ans: 30-40"), line("2) If the mean is 20"), line("3 What is the range")];

  it("finds each question by its number, in order", () => {
    const found = locateMarkers(sheet, [{ questionNumber: 1 }, { questionNumber: 2 }, { questionNumber: 3 }]);
    expect([...found]).toEqual([[1, 1], [2, 3], [3, 4]]);
  });

  it("ignores a number in the middle of a line", () => {
    expect(at([line("The answer is 3 apples"), line("3. real marker")], 3)).toBe(1);
  });

  it("ignores a number that is the first word of a calculation line only when it is not a label form", () => {
    expect(at([line("3x + 2 = 5"), line("3. Solve")], 3)).toBe(1);
  });
});

describe("locateMarkers — the label forms from the plan", () => {
  it.each([
    "Q.1 Find x",
    "Q 1 Find x",
    "Q1) Find x",
    "Q1. Find x",
    "Q1: Find x",
    "Ans 1 Find x",
    "Ans. 1 Find x",
    "Question 1 Find x",
    "(1) Find x",
    "1) Find x",
    "1. Find x",
    "q1 find x",
  ])("%j is the marker for question 1", (text) => {
    expect(at([line("Name: Test"), line(text)], 1)).toBe(1);
  });
});

describe("locateMarkers — parts and nested parts", () => {
  const paper = [
    line("1. (a) Define velocity"),
    line("Ans velocity is rate of change of displacement"),
    line("(b) State Newton's law"),
    line("Ans F = ma"),
    line("2. Calculate the force"),
    line("(i) first part"),
    line("(ii) second part"),
  ];
  const targets = [
    { questionNumber: 1, label: "1(a)" },
    { questionNumber: 2, label: "1(b)" },
    { questionNumber: 3, label: "2(i)" },
    { questionNumber: 4, label: "2(ii)" },
  ];

  it("finds the first part on the line that carries the question number and the next parts on their own lines", () => {
    const found = locateMarkers(paper, targets);
    expect(found.get(1)).toBe(0);
    expect(found.get(2)).toBe(2);
    expect(found.get(4)).toBe(6);
  });

  it("a first part with no line of its own starts on the question-number line", () => {
    const found = locateMarkers(paper, targets);
    expect(found.get(3)).toBe(5); // "(i)" has its own line here
    expect(at([line("2. Calculate the force"), line("working")], 5, "2(a)")).toBe(0);
  });

  it("reads a fully written part: 2(b)", () => {
    expect(at([line("2(a) one"), line("2(b) two")], 7, "2(b)")).toBe(1);
  });

  it("reads 3b and 3.b", () => {
    expect(at([line("3a one"), line("3b two")], 2, "3(b)")).toBe(1);
    expect(at([line("3.a one"), line("3.b two")], 2, "3(b)")).toBe(1);
  });

  it("a part written alone is never mistaken for another question's part", () => {
    // Searching for 2(b) must not stop at the (b) that belongs to question 1.
    const lines = [line("1. (a) x"), line("(b) y"), line("2. (a) z"), line("(b) w")];
    const found = locateMarkers(lines, [
      { questionNumber: 1, label: "1(a)" },
      { questionNumber: 2, label: "1(b)" },
      { questionNumber: 3, label: "2(a)" },
      { questionNumber: 4, label: "2(b)" },
    ]);
    expect([...found]).toEqual([[1, 0], [2, 1], [3, 2], [4, 3]]);
  });

  it("a nested part written alone, 'ii)', stands for the target's last part", () => {
    const lines = [line("4(a) first"), line("(i) a"), line("ii) b")];
    expect(at(lines, 3, "4(a)(ii)")).toBe(2);
  });
});

describe("locateMarkers — never marks in the wrong place", () => {
  it("skips a marker the detector was unsure of, and keeps looking", () => {
    const lines = [line("1.", 25), line("Find the mean"), line("1. second try", 90)];
    expect(at(lines, 1)).toBe(2);
  });

  it("a question with no confident marker is absent, not guessed", () => {
    expect(locateMarkers([line("1.", 25), line("some text")], [{ questionNumber: 1 }]).size).toBe(0);
  });

  it("searches in paper order, each after the previous, so a later question cannot match an earlier line", () => {
    const lines = [line("2. appears first"), line("1. appears second")];
    const found = locateMarkers(lines, [{ questionNumber: 1 }, { questionNumber: 2 }]);
    // Question 1 is found at line 1; question 2 must come after it, so it is not found at line 0.
    expect(found.get(1)).toBe(1);
    expect(found.has(2)).toBe(false);
  });

  it("an empty page finds nothing", () => {
    expect(locateMarkers([], [{ questionNumber: 1 }]).size).toBe(0);
    expect(locateMarkers([{ words: [] }], [{ questionNumber: 1 }]).size).toBe(0);
  });

  it("a target with no number to look for is ignored", () => {
    expect(locateMarkers([line("(a) text")], [{ questionNumber: 1, label: "(a)" }]).size).toBe(0);
  });
});
