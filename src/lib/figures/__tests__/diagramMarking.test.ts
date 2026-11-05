import { beforeEach, describe, expect, it, vi } from "vitest";

const crops: Array<{ id: string; pageNumber: number; storageKey: string; confident: boolean }> = [];
let references: Array<{ role: "QUESTION_FIGURE" | "MODEL_DIAGRAM"; png: Buffer }> = [];
let runs: unknown[] = [];

vi.mock("@/lib/prisma", () => ({ prisma: { diagramCrop: { findMany: async () => crops } } }));
vi.mock("@/lib/storage/questionFigures", () => ({ readFigureFile: async (key: string) => (key.startsWith("missing") ? null : Buffer.from(key)) }));
vi.mock("@/lib/figures/figureStore", () => ({ figuresForQuestion: async () => references }));
vi.mock("@/lib/figures/diagramJudging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/figures/diagramJudging")>("@/lib/figures/diagramJudging");
  return { ...actual, judgeDiagram: async () => runs };
});

import { diagramFeedback, markDiagramAnswer, referenceKindOf } from "@/lib/figures/diagramMarking";

const criteria = [
  { id: "c1", kind: "VALUE_POINT" as const, description: "A ray parallel to the axis is drawn", marks: 1 },
  { id: "c2", kind: "VALUE_POINT" as const, description: "Arrows show the direction", marks: 1 },
];
const run = (answers: Array<"yes" | "no" | "unclear">) => ({
  drawingPresent: true,
  legibility: "high",
  outcomes: criteria.map((c, i) => ({ id: c.id, met: answers[i], evidence: "seen" })),
});
const input = { submissionId: "s1", questionId: "q1", questionNumber: 4, questionText: "Draw it", subject: "Physics", maximumMarks: 2, criteria };

describe("referenceKindOf", () => {
  it("says which references there are", () => {
    expect(referenceKindOf([])).toBe("NONE");
    expect(referenceKindOf(["QUESTION_FIGURE"])).toBe("PAPER_FIGURE");
    expect(referenceKindOf(["MODEL_DIAGRAM"])).toBe("MODEL_DIAGRAM");
    expect(referenceKindOf(["QUESTION_FIGURE", "MODEL_DIAGRAM"])).toBe("BOTH");
  });
});

describe("diagramFeedback", () => {
  it("is written from the criteria, naming what was clearly shown and what was not", () => {
    expect(diagramFeedback([{ description: "an axis", met: "yes" }, { description: "arrows", met: "no" }, { description: "the focus", met: "unclear" }])).toBe(
      "Your diagram clearly showed: an axis. It did not clearly show: arrows; the focus.",
    );
    expect(diagramFeedback([{ description: "an axis", met: "yes" }])).toBe("Your diagram clearly showed: an axis.");
  });
});

describe("markDiagramAnswer", () => {
  beforeEach(() => {
    crops.length = 0;
    references = [{ role: "MODEL_DIAGRAM", png: Buffer.from("model") }];
    runs = [run(["yes", "no"]), run(["yes", "no"]), run(["yes", "no"])];
  });

  it("is held, with no mark, when no diagram was found for the question", async () => {
    const result = await markDiagramAnswer(input);
    expect("held" in result && result.held).toContain("No diagram could be found");
  });

  it("is held when the cropped file is gone", async () => {
    crops.push({ id: "k1", pageNumber: 2, storageKey: "missing-1", confident: true });
    const result = await markDiagramAnswer(input);
    expect("held" in result && result.held).toContain("unavailable");
  });

  it("is held, never marked zero, when the checker could not complete a single run", async () => {
    crops.push({ id: "k1", pageNumber: 2, storageKey: "a", confident: true });
    runs = [];
    const result = await markDiagramAnswer(input);
    expect("held" in result && result.held).toContain("could not be checked");
  });

  it("drafts an unflagged mark when everything is very clear", async () => {
    crops.push({ id: "k1", pageNumber: 2, storageKey: "a", confident: true });
    const result = await markDiagramAnswer(input);
    if (!("correction" in result)) throw new Error("expected a draft");
    const { score } = result.correction;
    expect(score?.awardedMarks).toBe(1);
    expect(score?.maximumMarks).toBe(2);
    expect(score?.marking?.unsure).toBe(false);
    expect(score?.marking?.reasons).toEqual([]);
    expect(score?.marking?.diagram).toMatchObject({ cropIds: ["k1"], reference: "MODEL_DIAGRAM", cropsConfident: true, legibility: "high" });
    expect(score?.marking?.runTotals).toEqual([1, 1, 1]);
    expect(result.correction.reading).toMatchObject({ attempted: true, containsDiagram: true, agreementConfidence: "high" });
  });

  it("drafts a FLAGGED mark, with the reasons, when the crop was not certain or there is no reference", async () => {
    crops.push({ id: "k1", pageNumber: 2, storageKey: "a", confident: false });
    references = [];
    const result = await markDiagramAnswer(input);
    if (!("correction" in result)) throw new Error("expected a draft");
    const marking = result.correction.score?.marking;
    expect(marking?.unsure).toBe(true);
    expect(marking?.reasons.join(" ")).toContain("not certain");
    expect(marking?.reasons.join(" ")).toContain("checklist alone");
    expect(result.correction.score?.awardedMarks).toBe(1); // the draft is still shown to the teacher
    expect(result.correction.reading.agreementConfidence).toBe("low");
  });

  it("counts a feature the checker could not tell as not earned and says so on that criterion", async () => {
    crops.push({ id: "k1", pageNumber: 2, storageKey: "a", confident: true });
    runs = [run(["yes", "unclear"]), run(["yes", "unclear"]), run(["yes", "unclear"])];
    const result = await markDiagramAnswer(input);
    if (!("correction" in result)) throw new Error("expected a draft");
    const second = result.correction.score?.marking?.criteria.find((c) => c.id === "c2");
    expect(second?.awarded).toBe(0);
    expect(second?.note).toContain("could not tell");
    expect(result.correction.score?.marking?.unsure).toBe(true);
  });
});
