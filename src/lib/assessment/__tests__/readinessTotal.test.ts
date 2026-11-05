import { describe, expect, it, vi } from "vitest";

// readiness.ts also holds a database fetch; only its pure calculation is under test here.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { computeAssessmentReadiness } from "@/lib/assessment/readiness";

const q = (id: string, number: number, marks: number, label?: string) => ({ id, questionNumber: number, label: label ?? null, maximumMarks: marks, rubric: null });

describe("what the paper is out of, on the assessment page", () => {
  const questions = [q("a", 1, 2, "1(a)"), q("b", 2, 2, "1(b)"), q("c", 3, 3, "2(a)"), q("d", 4, 3, "2(b)"), q("e", 5, 1, "3(a)"), q("f", 6, 1, "3(b)"), q("g", 7, 1, "3(c)")];
  const tree = {
    nodes: [
      { kind: "GROUP", label: "1", children: [{ kind: "LEAF", questionId: "a" }, { kind: "LEAF", questionId: "b" }] },
      { kind: "CHOICE", label: "2", children: [{ kind: "LEAF", questionId: "c" }, { kind: "LEAF", questionId: "d" }] },
      { kind: "OPTIONAL", label: "3", pick: 2, children: [{ kind: "LEAF", questionId: "e" }, { kind: "LEAF", questionId: "f" }, { kind: "LEAF", questionId: "g" }] },
    ],
  };

  it("counts parts, one of a choice and the best N of an optional group, not everything printed", () => {
    expect(computeAssessmentReadiness(questions, tree).totalMarks).toBe(9);
  });

  it("is the plain sum for a paper with no structure", () => {
    expect(computeAssessmentReadiness(questions).totalMarks).toBe(13);
    expect(computeAssessmentReadiness(questions, null).totalMarks).toBe(13);
  });

  it("names each question by its label", () => {
    expect(computeAssessmentReadiness(questions, tree).questions.map((item) => item.label)).toEqual(["1(a)", "1(b)", "2(a)", "2(b)", "3(a)", "3(b)", "3(c)"]);
  });
});
