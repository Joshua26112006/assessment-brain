import { describe, expect, it } from "vitest";
import { resolveStructure, treeForQuestions } from "@/lib/questionPaperExtraction/approvalStructure";
import type { DraftTreeNode } from "@/types/questionPaper";

const draft = {
  questions: [
    { number: 1, label: "1(a)", answerType: "SHORT_TEXT" },
    { number: 2, label: "1(b)", answerType: "NUMERIC" },
    { number: 3, label: "2", answerType: "BOGUS" },
  ],
  tree: [
    { kind: "GROUP", label: "1", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] },
    { kind: "LEAF", number: 3 },
  ],
};

describe("resolveStructure", () => {
  it("carries labels and valid answer types onto the questions", () => {
    const result = resolveStructure([{ number: 1 }, { number: 2 }, { number: 3 }], draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels.get(2)).toBe("1(b)");
    expect(result.answerTypes.get(2)).toBe("NUMERIC");
    expect(result.answerTypes.has(3)).toBe(false); // an invalid suggestion is dropped
    expect(result.tree).toHaveLength(2);
  });

  it("refuses when a structured paper's questions were removed or renumbered, rather than changing the totals silently", () => {
    expect(resolveStructure([{ number: 1 }, { number: 2 }], draft)).toMatchObject({ ok: false, message: expect.stringMatching(/only their text and marks/) });
    expect(resolveStructure([{ number: 1 }, { number: 2 }, { number: 9 }], draft).ok).toBe(false);
    expect(resolveStructure([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }], draft).ok).toBe(false);
  });

  it("a plain paper may be freely edited: labels carry over, no tree, no restriction", () => {
    const plain = { questions: [{ number: 1, label: "1" }, { number: 2, label: "2" }] };
    const result = resolveStructure([{ number: 1 }, { number: 5 }], plain);
    expect(result).toMatchObject({ ok: true, tree: null });
  });

  it("an old draft with no labels or structure still approves", () => {
    expect(resolveStructure([{ number: 1 }], { questions: [{ number: 1, text: "x" }] })).toMatchObject({ ok: true, tree: null });
    expect(resolveStructure([{ number: 1 }], null)).toMatchObject({ ok: true, tree: null });
    expect(resolveStructure([{ number: 1 }], "garbage")).toMatchObject({ ok: true, tree: null });
  });

  it("ignores a stored tree that is malformed", () => {
    expect(resolveStructure([{ number: 1 }], { questions: [{ number: 1 }], tree: [{ kind: "LEAF" }] })).toMatchObject({ ok: true, tree: null });
  });
});

describe("treeForQuestions", () => {
  const tree: DraftTreeNode[] = [
    { kind: "CHOICE", label: "5", children: [{ kind: "LEAF", number: 1 }, { kind: "LEAF", number: 2 }] },
    { kind: "OPTIONAL", pick: 1, children: [{ kind: "LEAF", number: 3 }, { kind: "LEAF", number: 4 }] },
  ];
  const ids = new Map([[1, "qa"], [2, "qb"], [3, "qc"], [4, "qd"]]);

  it("points each leaf at the real question", () => {
    expect(treeForQuestions(tree, ids)).toEqual({
      nodes: [
        { kind: "CHOICE", label: "5", children: [{ kind: "LEAF", questionId: "qa" }, { kind: "LEAF", questionId: "qb" }] },
        { kind: "OPTIONAL", pick: 1, children: [{ kind: "LEAF", questionId: "qc" }, { kind: "LEAF", questionId: "qd" }] },
      ],
    });
  });

  it("is null when a leaf has no question, or the structure is not valid for them", () => {
    expect(treeForQuestions(tree, new Map([[1, "qa"], [2, "qb"], [3, "qc"]]))).toBeNull();
    expect(treeForQuestions([{ kind: "CHOICE", children: [{ kind: "LEAF", number: 1 }] }], new Map([[1, "qa"]]))).toBeNull();
  });
});
