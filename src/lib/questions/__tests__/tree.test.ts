import { describe, expect, it } from "vitest";
import {
  computeTotals,
  flatTree,
  leafIdsOf,
  paperMaximum,
  parseTree,
  validateTree,
  type LeafResult,
  type QuestionTree,
} from "@/lib/questions/tree";

const leaf = (questionId: string) => ({ kind: "LEAF" as const, questionId });
const leaves = (entries: Record<string, [number, number | null, boolean]>) =>
  new Map<string, LeafResult>(
    Object.entries(entries).map(([id, [maximumMarks, awardedMarks, attempted]]) => [id, { maximumMarks, awardedMarks, attempted }]),
  );

describe("computeTotals — a flat paper (every paper before trees existed)", () => {
  it("adds up what was awarded, out of every question's marks", () => {
    const totals = computeTotals(flatTree(["a", "b", "c"]), leaves({ a: [4, 3, true], b: [4, 1, true], c: [2, null, false] }));
    expect(totals).toMatchObject({ awarded: 4, maximum: 10, unmarkedCount: 0 });
  });

  it("counts an attempted answer with no mark as waiting, not as zero silently", () => {
    const totals = computeTotals(flatTree(["a", "b"]), leaves({ a: [4, 3, true], b: [4, null, true] }));
    expect(totals.awarded).toBe(3);
    expect(totals.unmarkedCount).toBe(1);
  });

  it("an empty paper is 0 out of 0", () => {
    expect(computeTotals({ nodes: [] }, new Map())).toMatchObject({ awarded: 0, maximum: 0 });
  });
});

describe("computeTotals — parts that all count", () => {
  const tree: QuestionTree = { nodes: [{ kind: "GROUP", label: "1", children: [leaf("1a"), leaf("1b")] }, leaf("2")] };

  it("sums the parts", () => {
    const totals = computeTotals(tree, leaves({ "1a": [2, 2, true], "1b": [3, 1, true], "2": [5, 4, true] }));
    expect(totals).toMatchObject({ awarded: 7, maximum: 10 });
  });
});

describe("computeTotals — internal choice (D14)", () => {
  const choice: QuestionTree = { nodes: [{ kind: "CHOICE", label: "3", children: [leaf("3a"), leaf("3b")] }] };

  it("counts only the one attempted when the student answered one", () => {
    const totals = computeTotals(choice, leaves({ "3a": [5, 4, true], "3b": [5, null, false] }));
    expect(totals).toMatchObject({ awarded: 4, maximum: 5 });
    expect(totals.perLeaf.get("3a")).toEqual({ counted: true, overAttempt: false });
    // Not attempted: simply not counted, and not an over attempt.
    expect(totals.perLeaf.get("3b")).toEqual({ counted: false, overAttempt: false });
  });

  it("when both are attempted, counts the higher and shows the other as an over attempt", () => {
    const totals = computeTotals(choice, leaves({ "3a": [5, 2, true], "3b": [5, 4, true] }));
    expect(totals).toMatchObject({ awarded: 4, maximum: 5 });
    expect(totals.perLeaf.get("3b")).toEqual({ counted: true, overAttempt: false });
    expect(totals.perLeaf.get("3a")).toEqual({ counted: false, overAttempt: true });
  });

  it("a tie goes to the first alternative", () => {
    const totals = computeTotals(choice, leaves({ "3a": [5, 3, true], "3b": [5, 3, true] }));
    expect(totals.perLeaf.get("3a")?.counted).toBe(true);
    expect(totals.perLeaf.get("3b")?.overAttempt).toBe(true);
  });

  it("when neither is attempted, nothing counts but the paper is still out of the choice's marks", () => {
    const totals = computeTotals(choice, leaves({ "3a": [5, null, false], "3b": [5, null, false] }));
    expect(totals).toMatchObject({ awarded: 0, maximum: 5 });
    expect(totals.perLeaf.get("3a")?.overAttempt).toBe(false);
  });

  it("the paper's maximum does not double-count the alternatives", () => {
    const tree: QuestionTree = { nodes: [leaf("1"), { kind: "CHOICE", children: [leaf("2a"), leaf("2b")] }] };
    expect(paperMaximum(tree, new Map([["1", 3], ["2a", 5], ["2b", 5]]))).toBe(8);
  });

  it("a part inside an alternative: the whole alternative is chosen or excluded together", () => {
    const tree: QuestionTree = {
      nodes: [
        {
          kind: "CHOICE",
          children: [
            { kind: "GROUP", label: "4(a)", children: [leaf("4a1"), leaf("4a2")] },
            { kind: "GROUP", label: "4(b)", children: [leaf("4b1"), leaf("4b2")] },
          ],
        },
      ],
    };
    const totals = computeTotals(tree, leaves({ "4a1": [2, 2, true], "4a2": [3, 1, true], "4b1": [2, 2, true], "4b2": [3, 3, true] }));
    // 4(b) scored 5, 4(a) scored 3: 4(b) counts, and BOTH leaves of 4(a) are over attempts.
    expect(totals).toMatchObject({ awarded: 5, maximum: 5 });
    expect(totals.perLeaf.get("4a1")).toEqual({ counted: false, overAttempt: true });
    expect(totals.perLeaf.get("4a2")).toEqual({ counted: false, overAttempt: true });
    expect(totals.perLeaf.get("4b2")).toEqual({ counted: true, overAttempt: false });
  });
});

describe("computeTotals — optional, any N of M (D14)", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const optional: QuestionTree = { nodes: [{ kind: "OPTIONAL", pick: 5, children: ids.map(leaf) }] };

  it("counts the best 5 of 7 attempted and marks the lowest two as over attempts", () => {
    const totals = computeTotals(
      optional,
      leaves(Object.fromEntries(ids.map((id, i) => [id, [2, [2, 2, 1, 2, 0, 1, 2][i], true]]))),
    );
    // Marks: a2 b2 c1 d2 e0 f1 g2 -> best five are 2,2,2,2 and one of the 1s.
    expect(totals.awarded).toBe(9);
    expect(totals.maximum).toBe(10);
    const over = ids.filter((id) => totals.perLeaf.get(id)?.overAttempt);
    expect(over).toHaveLength(2);
    expect(over).toContain("e"); // the 0 is always among the excluded
  });

  it("ties are broken by paper order: the earlier of equal marks counts", () => {
    const totals = computeTotals(
      { nodes: [{ kind: "OPTIONAL", pick: 1, children: [leaf("a"), leaf("b"), leaf("c")] }] },
      leaves({ a: [2, 1, true], b: [2, 1, true], c: [2, 1, true] }),
    );
    expect(totals.perLeaf.get("a")?.counted).toBe(true);
    expect(totals.perLeaf.get("b")?.overAttempt).toBe(true);
    expect(totals.perLeaf.get("c")?.overAttempt).toBe(true);
  });

  it("when fewer than N are attempted, all attempted count and none is an over attempt", () => {
    const totals = computeTotals(optional, leaves({ a: [2, 2, true], b: [2, 1, true], c: [2, null, false], d: [2, null, false], e: [2, null, false], f: [2, null, false], g: [2, null, false] }));
    expect(totals.awarded).toBe(3);
    expect(ids.some((id) => totals.perLeaf.get(id)?.overAttempt)).toBe(false);
    expect(totals.maximum).toBe(10);
  });

  it("a pick larger than the number of questions counts them all", () => {
    const totals = computeTotals({ nodes: [{ kind: "OPTIONAL", pick: 9, children: [leaf("a"), leaf("b")] }] }, leaves({ a: [2, 2, true], b: [3, 3, true] }));
    expect(totals).toMatchObject({ awarded: 5, maximum: 5 });
  });

  it("unequal marks: the paper maximum is the best N by size", () => {
    expect(paperMaximum({ nodes: [{ kind: "OPTIONAL", pick: 2, children: [leaf("a"), leaf("b"), leaf("c")] }] }, new Map([["a", 1], ["b", 5], ["c", 3]]))).toBe(8);
  });
});

describe("validateTree", () => {
  it("accepts a good tree", () => {
    expect(validateTree({ nodes: [{ kind: "CHOICE", children: [leaf("a"), leaf("b")] }, leaf("c")] }, ["a", "b", "c"])).toEqual({ ok: true });
  });

  it("rejects a leaf that does not exist, a repeated leaf and a missing leaf", () => {
    const result = validateTree({ nodes: [leaf("a"), leaf("a"), leaf("ghost")] }, ["a", "b"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/does not exist/);
      expect(result.errors.join(" ")).toMatch(/more than once/);
      expect(result.errors.join(" ")).toMatch(/missing from the paper/);
    }
  });

  it("rejects a choice with one alternative and an 'any N' that cannot be met", () => {
    expect(validateTree({ nodes: [{ kind: "CHOICE", children: [leaf("a")] }] }, ["a"]).ok).toBe(false);
    expect(validateTree({ nodes: [{ kind: "OPTIONAL", pick: 3, children: [leaf("a"), leaf("b")] }] }, ["a", "b"]).ok).toBe(false);
    expect(validateTree({ nodes: [{ kind: "OPTIONAL", pick: 0, children: [leaf("a"), leaf("b")] }] }, ["a", "b"]).ok).toBe(false);
  });

  it("rejects an empty group", () => {
    expect(validateTree({ nodes: [{ kind: "GROUP", children: [] }] }, []).ok).toBe(false);
  });
});

describe("parseTree / leafIdsOf", () => {
  it("round-trips a stored tree and lists its leaves in paper order", () => {
    const raw = { nodes: [leaf("a"), { kind: "OPTIONAL", pick: 1, label: "Q2", children: [leaf("b"), leaf("c")] }] };
    const tree = parseTree(raw);
    expect(tree).toEqual(raw);
    expect(leafIdsOf(tree!)).toEqual(["a", "b", "c"]);
  });

  it.each([null, undefined, "x", 3, {}, { nodes: "no" }, { nodes: [{ kind: "LEAF" }] }, { nodes: [{ kind: "WIZARD", children: [] }] }, { nodes: [{ kind: "OPTIONAL", children: [] }] }])(
    "returns null for %j so the paper is treated as flat",
    (raw) => {
      expect(parseTree(raw)).toBeNull();
    },
  );
});
