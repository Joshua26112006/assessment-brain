import { describe, expect, it } from "vitest";
import { findQuestionByLabel, labelOf, labelsMatch, normalizeLabel, parseLabel } from "@/lib/questions/labels";

describe("labelOf", () => {
  it("uses the stored label, or the number for a question created before labels existed", () => {
    expect(labelOf({ label: "3(b)", questionNumber: 4 })).toBe("3(b)");
    expect(labelOf({ label: null, questionNumber: 7 })).toBe("7");
    expect(labelOf({ label: "  ", questionNumber: 7 })).toBe("7");
    expect(labelOf({ questionNumber: 2 })).toBe("2");
  });
});

describe("parseLabel — the forms from the plan", () => {
  it.each([
    ["3", 3, []],
    ["3.", 3, []],
    ["3)", 3, []],
    ["(3)", 3, []],
    ["Q3", 3, []],
    ["q3", 3, []],
    ["Q.3", 3, []],
    ["Q 3", 3, []],
    ["Q3)", 3, []],
    ["Q3.", 3, []],
    ["Q3:", 3, []],
    ["Question 3", 3, []],
    ["Ans 3", 3, []],
    ["Ans. 3", 3, []],
    ["Answer 3", 3, []],
    ["10.", 10, []],
  ])("reads %j as question %i", (text, number, parts) => {
    expect(parseLabel(text)).toEqual({ number, parts });
  });

  it.each([
    ["3(b)", 3, ["b"]],
    ["3 (b)", 3, ["b"]],
    ["3. (a)", 3, ["a"]],
    ["3(b)(ii)", 3, ["b", "ii"]],
    ["Q.3(b)", 3, ["b"]],
    ["Q3(B)", 3, ["b"]],
    ["3b", 3, ["b"]],
    ["3.b", 3, ["b"]],
    ["3-b", 3, ["b"]],
    ["1(a) Define velocity", 1, ["a"]],
    ["Ans 2(c)(iii)", 2, ["c", "iii"]],
  ])("reads %j as %i with parts %j", (text, number, parts) => {
    expect(parseLabel(text)).toEqual({ number, parts });
  });

  it.each([
    ["(a)", ["a"]],
    ["a)", ["a"]],
    ["(ii)", ["ii"]],
    ["ii)", ["ii"]],
    ["(b)(ii)", ["b", "ii"]],
    ["(c) Find the mean", ["c"]],
  ])("reads a part written alone: %j", (text, parts) => {
    expect(parseLabel(text)).toEqual({ number: null, parts });
  });

  it("ignores whatever follows the label", () => {
    expect(parseLabel("3. What is the range of the data?")).toEqual({ number: 3, parts: [] });
  });

  it.each(["", "   ", "x = 4", "3x + 2 = 5", "apples", "Ans", "Q", "quantity 3", "abc)", "(abc)", "(zz)", "xyz"])(
    "does not read %j as a label",
    (text) => {
      const parsed = parseLabel(text);
      // "3x + 2 = 5" is an equation: a bare x after a number is not a part (only a-h are).
      expect(parsed === null || (text === "3x + 2 = 5" && parsed.parts.length === 0)).toBe(true);
    },
  );

  it("does not treat a letter after a number as a part unless it is a-h", () => {
    expect(parseLabel("3 apples")).toEqual({ number: 3, parts: [] });
    expect(parseLabel("3b")).toEqual({ number: 3, parts: ["b"] });
  });

  it.each(["3x", "3x + 2 = 5", "3.5 m", "3,000 kg", "3/4", "3-4", "3 - 4", "3 + 2 = 5", "3²", "3 = x", "3apples"])(
    "working that starts with a number is not a label: %j",
    (text) => {
      expect(parseLabel(text)).toBeNull();
    },
  );

  it("when recognising the START of a scanned line, a bare letter after a space is not a part", () => {
    expect(parseLabel("3 b something")).toEqual({ number: 3, parts: [] });
  });

  it("when matching a label somebody wrote, it is", () => {
    expect(parseLabel("3 b", { loose: true })).toEqual({ number: 3, parts: ["b"] });
    expect(parseLabel("3 apples", { loose: true })).toEqual({ number: 3, parts: [] });
  });
});

describe("normalizeLabel / labelsMatch", () => {
  it("makes every way of writing a label the same", () => {
    const forms = ["3(b)", "Q.3 (b)", "Q3b", "3.b", "Ans 3(B)", "Question 3(b)"];
    for (const form of forms) expect(normalizeLabel(form), form).toBe("3(b)");
  });

  it("keeps nested parts in order", () => {
    expect(normalizeLabel("2 (a) (iii)")).toBe("2(a)(iii)");
  });

  it("writes a part alone as just the part", () => {
    expect(normalizeLabel("b)")).toBe("(b)");
  });

  it("is null for text that is not a label", () => {
    expect(normalizeLabel("hello")).toBeNull();
  });

  it("matches the same question, never a different one", () => {
    expect(labelsMatch("3(b)", "Q.3 b")).toBe(true); // a label somebody wrote: "3 b" is 3(b)
    expect(labelsMatch("3(b)", "Q3(b)")).toBe(true);
    expect(labelsMatch("3(b)", "3(c)")).toBe(false);
    expect(labelsMatch("3", "3(a)")).toBe(false);
    expect(labelsMatch("3", "Q3.")).toBe(true);
    expect(labelsMatch("zzz", "zzz")).toBe(false);
  });
});

describe("findQuestionByLabel", () => {
  const questions = [
    { questionNumber: 1, label: "1(a)" },
    { questionNumber: 2, label: "1(b)" },
    { questionNumber: 3, label: null },
    { questionNumber: 4, label: "2(a)(ii)" },
  ];

  it("finds a part by however the model or student wrote it", () => {
    expect(findQuestionByLabel("Q.1(b)", questions)?.questionNumber).toBe(2);
    expect(findQuestionByLabel("2(a)(ii)", questions)?.questionNumber).toBe(4);
  });

  it("finds a question created before labels existed by its number", () => {
    expect(findQuestionByLabel("3", questions)?.questionNumber).toBe(3);
    expect(findQuestionByLabel("Q3.", questions)?.questionNumber).toBe(3);
  });

  it("returns null when nothing matches", () => {
    expect(findQuestionByLabel("9", questions)).toBeNull();
    expect(findQuestionByLabel("hello", questions)).toBeNull();
  });
});
