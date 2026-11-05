import { describe, expect, it } from "vitest";
import { mergeApproachEdits, mergeCheckpointEdits } from "@/lib/scheme/merge";
import type { SchemeCriterion } from "@/lib/scheme/criteria";

const existing: SchemeCriterion[] = [
  { id: "c1", kind: "STEP", description: "Writes v = u + at", marks: 1 },
  { id: "c2", kind: "FINAL_ANSWER", description: "Correct final answer", marks: 2 },
  { id: "c3", kind: "UNIT", description: "States the unit", marks: 1, unit: "m/s" },
];

describe("mergeCheckpointEdits", () => {
  it("keeps a criterion's kind and unit when the teacher only changes its marks", () => {
    const result = mergeCheckpointEdits(
      existing,
      [
        { description: "Writes v = u + at", marks: 1.5 },
        { description: "Correct final answer", marks: 2 },
        { description: "States the unit", marks: 0.5 },
      ],
      4,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.criteria.map((c) => c.kind)).toEqual(["STEP", "FINAL_ANSWER", "UNIT"]);
    expect(result.criteria[2].unit).toBe("m/s");
    expect(result.criteria.map((c) => c.marks)).toEqual([1.5, 2, 0.5]);
  });

  it("matches a description regardless of case and spacing", () => {
    const result = mergeCheckpointEdits(existing, [{ description: "  CORRECT   final answer ", marks: 4 }], 4);
    expect(result.ok && result.criteria[0].kind).toBe("FINAL_ANSWER");
  });

  it("makes a new checkpoint a step", () => {
    const result = mergeCheckpointEdits(existing, [{ description: "Draws a diagram", marks: 4 }], 4);
    expect(result.ok && result.criteria[0].kind).toBe("STEP");
  });

  it("does not silently adjust a teacher's marks that do not add up", () => {
    const result = mergeCheckpointEdits(existing, [{ description: "Writes v = u + at", marks: 1 }], 4);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/add up to 1 marks, but the question is worth 4/) });
  });

  it("rejects marks that are not a multiple of 0.5", () => {
    const result = mergeCheckpointEdits(existing, [{ description: "a", marks: 2.37 }, { description: "b", marks: 1.63 }], 4);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/0\.5/) });
  });

  it("gives every criterion a unique id", () => {
    const result = mergeCheckpointEdits([], [{ description: "a", marks: 2 }, { description: "b", marks: 2 }], 4);
    expect(result.ok && new Set(result.criteria.map((c) => c.id)).size).toBe(2);
  });

  it("an empty checkpoint list is rejected", () => {
    expect(mergeCheckpointEdits(existing, [], 4).ok).toBe(false);
  });
});

describe("mergeApproachEdits", () => {
  const stored = [
    { label: "Kinematics", description: "old", steps: ["v = u + at", "substitute"], isPrimary: true },
    { label: "Energy", description: "alt", steps: ["KE"], isPrimary: false },
  ];

  it("keeps the steps and the primary flag of an approach the teacher only re-worded", () => {
    const merged = mergeApproachEdits(stored, [
      { label: "Kinematics", description: "new wording" },
      { label: "Energy", description: "alt" },
    ]);
    expect(merged[0]).toMatchObject({ description: "new wording", steps: ["v = u + at", "substitute"], isPrimary: true });
    expect(merged[1].isPrimary).toBe(false);
  });

  it("gives a new approach no steps, and keeps one approach primary if the primary was removed", () => {
    const merged = mergeApproachEdits(stored, [{ label: "Graphical", description: "g" }]);
    expect(merged[0]).toMatchObject({ steps: [], isPrimary: true });
  });
});
