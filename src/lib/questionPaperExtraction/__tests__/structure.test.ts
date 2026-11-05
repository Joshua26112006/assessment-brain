import { describe, expect, it } from "vitest";
import { describeTree, flattenExtraction } from "@/lib/questionPaperExtraction/structure";

describe("flattenExtraction — a plain paper is unchanged", () => {
  it("keeps the printed numbers, labels them with the number, and stores no tree", () => {
    const { questions, tree, warnings } = flattenExtraction([
      { number: 1, text: "Find the mode", marks: 2, uncertain: false },
      { number: 4, text: "Find the mean", marks: 4, uncertain: true },
    ]);
    expect(tree).toBeNull();
    expect(warnings).toEqual([]);
    expect(questions).toEqual([
      { number: 1, label: "1", text: "Find the mode", marks: 2, uncertain: false },
      { number: 4, label: "4", text: "Find the mean", marks: 4, uncertain: true },
    ]);
  });

  it("drops an item with no text or a bad number, and says so for the number", () => {
    const { questions, warnings } = flattenExtraction([
      { number: 1, text: "ok", marks: 1 },
      { number: 2, text: "   ", marks: 1 },
      { number: "x", text: "no number", marks: 1 },
      null,
      7,
    ]);
    expect(questions.map((q) => q.number)).toEqual([1]);
    expect(warnings).toHaveLength(1);
  });

  it("returns nothing for something that is not a list", () => {
    expect(flattenExtraction(undefined)).toEqual({ questions: [], tree: null, warnings: [] });
  });

  it("nulls a mark that is absent, negative, absurd or not a number", () => {
    const { questions } = flattenExtraction([
      { number: 1, text: "a" },
      { number: 2, text: "b", marks: -3 },
      { number: 3, text: "c", marks: 5000 },
      { number: 4, text: "d", marks: "5" },
    ]);
    expect(questions.map((q) => q.marks)).toEqual([null, null, null, null]);
  });
});

describe("flattenExtraction — parts that all count", () => {
  const raw = [
    {
      number: 1,
      text: "A car of mass 1000 kg accelerates uniformly.",
      parts: [
        { label: "(a)", text: "State Newton's second law.", marks: 2, answerType: "SHORT_TEXT" },
        { label: "(b)", text: "Find the force if a = 2 m/s^2.", marks: 3, answerType: "NUMERIC" },
      ],
    },
    { number: 2, text: "Define work.", marks: 2 },
  ];

  it("makes each part its own question, numbered in paper order, labelled as the paper writes them", () => {
    const { questions, tree } = flattenExtraction(raw);
    expect(questions.map((q) => [q.number, q.label])).toEqual([[1, "1(a)"], [2, "1(b)"], [3, "2"]]);
    expect(tree).toEqual([
      { kind: "GROUP", label: "1", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] },
      { kind: "LEAF", number: 3 },
    ]);
  });

  it("gives every part the shared stem so it can be marked on its own", () => {
    const { questions } = flattenExtraction(raw);
    expect(questions[1].text).toBe("A car of mass 1000 kg accelerates uniformly.\nFind the force if a = 2 m/s^2.");
    expect(questions[2].text).toBe("Define work.");
  });

  it("keeps the model's suggested answer type, and only a valid one", () => {
    const { questions } = flattenExtraction([
      { number: 1, text: "stem", parts: [{ label: "(a)", text: "x", marks: 1, answerType: "NUMERIC" }, { label: "(b)", text: "y", marks: 1, answerType: "MAGIC" }] },
    ]);
    expect(questions[0].answerType).toBe("NUMERIC");
    expect(questions[1].answerType).toBeUndefined();
  });

  it("labels parts with no label of their own (a), (b), ...", () => {
    const { questions } = flattenExtraction([{ number: 3, text: "stem", parts: [{ text: "x", marks: 1 }, { text: "y", marks: 1 }] }]);
    expect(questions.map((q) => q.label)).toEqual(["3(a)", "3(b)"]);
  });

  it("nests: 2(a)(ii)", () => {
    const { questions, tree } = flattenExtraction([
      { number: 2, text: "stem", parts: [{ label: "(a)", text: "A", parts: [{ label: "(i)", text: "one", marks: 1 }, { label: "(ii)", text: "two", marks: 1 }] }] },
    ]);
    expect(questions.map((q) => q.label)).toEqual(["2(a)(i)", "2(a)(ii)"]);
    expect(tree?.[0]).toMatchObject({ kind: "GROUP", children: [{ kind: "GROUP", children: [{ kind: "LEAF" }, { kind: "LEAF" }] }] });
  });
});

describe("flattenExtraction — internal choice", () => {
  it("makes a CHOICE of the alternatives, each its own question", () => {
    const { questions, tree } = flattenExtraction([
      { number: 5, text: "Answer either (a) or (b).", alternatives: [{ label: "(a)", text: "Describe osmosis.", marks: 5 }, { label: "(b)", text: "Describe diffusion.", marks: 5 }] },
    ]);
    expect(questions.map((q) => q.label)).toEqual(["5(a)", "5(b)"]);
    expect(tree).toEqual([{ kind: "CHOICE", label: "5", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] }]);
  });

  it("a choice with only one alternative left is just that question", () => {
    const { tree } = flattenExtraction([{ number: 5, text: "x", alternatives: [{ label: "(a)", text: "only", marks: 5 }, { label: "(b)", text: "  " }] }]);
    expect(tree).toEqual([{ kind: "LEAF", number: 1 }]);
  });

  it("a choice between two groups of parts", () => {
    const { tree, questions } = flattenExtraction([
      {
        number: 6,
        text: "",
        alternatives: [
          { label: "(a)", text: "A", parts: [{ label: "(i)", text: "a1", marks: 2 }, { label: "(ii)", text: "a2", marks: 3 }] },
          { label: "(b)", text: "B", parts: [{ label: "(i)", text: "b1", marks: 2 }, { label: "(ii)", text: "b2", marks: 3 }] },
        ],
      },
    ]);
    expect(questions.map((q) => q.label)).toEqual(["6(a)(i)", "6(a)(ii)", "6(b)(i)", "6(b)(ii)"]);
    expect(tree?.[0]).toMatchObject({ kind: "CHOICE", children: [{ kind: "GROUP" }, { kind: "GROUP" }] });
  });
});

describe("flattenExtraction — attempt any N", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ label: `(${i + 1})`, text: `Q${i + 1}`, marks: 2 }));

  it("makes an OPTIONAL group that counts the best N", () => {
    const { tree, questions } = flattenExtraction([{ number: 8, text: "Attempt any 5 of the following.", optional: { pick: 5, of: items } }]);
    expect(questions).toHaveLength(7);
    expect(tree?.[0]).toMatchObject({ kind: "OPTIONAL", pick: 5 });
    expect((tree?.[0] as { children: unknown[] }).children).toHaveLength(7);
  });

  it("clamps a pick that cannot be met, and a missing or silly pick, to the number of questions", () => {
    const tooMany = flattenExtraction([{ number: 8, text: "x", optional: { pick: 20, of: items } }]);
    expect((tooMany.tree?.[0] as { pick: number }).pick).toBe(7);
    const missing = flattenExtraction([{ number: 8, text: "x", optional: { of: items } }]);
    expect((missing.tree?.[0] as { pick: number }).pick).toBe(7);
    const zero = flattenExtraction([{ number: 8, text: "x", optional: { pick: 0, of: items } }]);
    expect((zero.tree?.[0] as { pick: number }).pick).toBe(7);
  });
});

describe("flattenExtraction — a mixed paper (the Phase 3 done-when)", () => {
  it("Q1 (a)(b), Q2 (a) OR (b), any 2 of Q3 to Q5, and an MCQ section", () => {
    const { questions, tree } = flattenExtraction([
      { number: 1, text: "stem", parts: [{ label: "(a)", text: "a", marks: 2 }, { label: "(b)", text: "b", marks: 3 }] },
      { number: 2, text: "", alternatives: [{ label: "(a)", text: "a", marks: 5 }, { label: "(b)", text: "b", marks: 5 }] },
      {
        number: 3,
        text: "Attempt any 2.",
        optional: { pick: 2, of: [{ label: "3", text: "x", marks: 4 }, { label: "4", text: "y", marks: 4 }, { label: "5", text: "z", marks: 4 }] },
      },
      { number: 6, text: "Capital of France? (A) Paris (B) Rome", marks: 1, answerType: "EXACT_KEY" },
      { number: 7, text: "Largest planet? (A) Mars (B) Jupiter", marks: 1, answerType: "EXACT_KEY" },
    ]);
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The three optional questions are printed as 3, 4 and 5, so that is what they are called.
    expect(questions.map((q) => q.label)).toEqual(["1(a)", "1(b)", "2(a)", "2(b)", "3", "4", "5", "6", "7"]);
    expect(tree?.map((node) => node.kind)).toEqual(["GROUP", "CHOICE", "OPTIONAL", "LEAF", "LEAF"]);
    expect(questions.filter((q) => q.answerType === "EXACT_KEY")).toHaveLength(2);
  });
});

describe("describeTree", () => {
  const labels = new Map([[1, "5(a)"], [2, "5(b)"], [3, "6"], [4, "7"], [5, "8"]]);

  it("says nothing for a paper that is simply 'answer everything'", () => {
    expect(describeTree([{ kind: "GROUP", label: "1", children: [{ kind: "LEAF", number: 1 }] }, { kind: "LEAF", number: 3 }], labels)).toEqual([]);
  });

  it("describes a choice and an optional group in plain words", () => {
    const lines = describeTree(
      [
        { kind: "CHOICE", label: "5", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] },
        { kind: "OPTIONAL", pick: 2, children: [{ kind: "LEAF", number: 3 }, { kind: "LEAF", number: 4 }, { kind: "LEAF", number: 5 }] },
      ],
      labels,
    );
    expect(lines).toEqual([
      "Answer ONE of: 5(a)  or  5(b). If a student answers both, the higher mark counts.",
      "Answer any 2 of 3: 6, 7, 8. The best 2 count.",
    ]);
  });

  it("finds a choice nested inside a group of parts", () => {
    const lines = describeTree(
      [{ kind: "GROUP", label: "9", children: [{ kind: "CHOICE", label: "9(b)", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] }] }],
      labels,
    );
    expect(lines).toHaveLength(1);
  });
});

describe("flattenExtraction — limits", () => {
  it("stops at a sensible depth rather than recursing forever", () => {
    let node: Record<string, unknown> = { text: "leaf", marks: 1 };
    for (let i = 0; i < 20; i++) node = { text: "stem", parts: [node] };
    expect(() => flattenExtraction([{ number: 1, text: "stem", parts: [node] }])).not.toThrow();
  });
});
