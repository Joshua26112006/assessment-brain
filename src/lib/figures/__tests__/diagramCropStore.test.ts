import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row { id: string; submissionId: string; storageKey: string; questionId: string | null; confident: boolean }
const rows: Row[] = [];
const files = new Map<string, Buffer>();
let created = 0;
let failOnCreateNumber = -1;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    diagramCrop: {
      findMany: async ({ where }: { where: { submissionId: string } }) =>
        rows.filter((r) => r.submissionId === where.submissionId).map((r) => ({ id: r.id, storageKey: r.storageKey })),
      create: async ({ data }: { data: Omit<Row, "id"> }) => {
        created++;
        if (created === failOnCreateNumber) throw new Error("database went away");
        const row = { id: `c${created}`, ...data };
        rows.push(row);
        return { id: row.id };
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) {
          const index = rows.findIndex((r) => r.id === id);
          if (index >= 0) rows.splice(index, 1);
        }
      },
    },
  },
}));
vi.mock("@/lib/storage/questionFigures", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/questionFigures")>("@/lib/storage/questionFigures");
  return {
    ...actual,
    writeFigureFile: async (key: string, buffer: Buffer) => void files.set(key, buffer),
    readFigureFile: async (key: string) => files.get(key) ?? null,
    removeFigureFile: async (key: string) => void files.delete(key),
  };
});
vi.mock("@/lib/handwritten/pages", () => ({ loadOrderedAnswerSheetPages: async () => [] }));
vi.mock("@/lib/structuredCorrection/annotation/textractPage", () => ({ analysePage: async () => ({ markers: new Map(), readingOrderWords: [] }) }));
vi.mock("@/lib/figures/modelDiagrams", () => ({ locateDiagramsWithModel: async () => [] }));

import { storeStudentDiagrams } from "@/lib/figures/diagramCropStore";
import type { DetectedStudentDiagram } from "@/lib/figures/studentDiagramDetection";

const diagram = (questionNumber: number | null, confident = true): DetectedStudentDiagram => ({
  pageNumber: 1, left: 0.1, top: 0.2, width: 0.5, height: 0.3, png: Buffer.from(`png-${questionNumber}`), pixelWidth: 10, pixelHeight: 10,
  questionNumber, confident, foundByInk: true, foundByModel: confident,
});
const detection = (items: DetectedStudentDiagram[]) => ({ diagrams: items, notes: [] });

describe("storeStudentDiagrams", () => {
  beforeEach(() => {
    rows.length = 0;
    files.clear();
    created = 0;
    failOnCreateNumber = -1;
  });

  it("stores each diagram with the question it follows and whether both methods agreed", async () => {
    const count = await storeStudentDiagrams("s1", detection([diagram(6, true), diagram(null, false)]), new Map([[6, "q6"]]));
    expect(count).toBe(2);
    expect(rows.map((r) => [r.questionId, r.confident])).toEqual([["q6", true], [null, false]]);
    expect(files.size).toBe(2);
  });

  it("keeps each submission's diagrams to itself", async () => {
    await storeStudentDiagrams("s1", detection([diagram(1)]), new Map([[1, "q1"]]));
    await storeStudentDiagrams("s2", detection([diagram(1)]), new Map([[1, "q1"]]));
    expect(rows).toHaveLength(2);
    await storeStudentDiagrams("s1", detection([]), new Map());
    expect(rows.map((r) => r.submissionId)).toEqual(["s2"]);
  });

  it("replaces an earlier finding only after the new one is safely stored", async () => {
    await storeStudentDiagrams("s1", detection([diagram(1)]), new Map([[1, "q1"]]));
    const earlierKey = rows[0].storageKey;
    await storeStudentDiagrams("s1", detection([diagram(1), diagram(1)]), new Map([[1, "q1"]]));
    expect(rows).toHaveLength(2);
    expect(files.has(earlierKey)).toBe(false);
    expect(files.size).toBe(2);
  });

  it("keeps the earlier crops and leaves no half-written files when the new store fails part-way", async () => {
    await storeStudentDiagrams("s1", detection([diagram(1)]), new Map([[1, "q1"]]));
    const earlierKey = rows[0].storageKey;
    failOnCreateNumber = created + 2;
    await expect(storeStudentDiagrams("s1", detection([diagram(1), diagram(1), diagram(1)]), new Map([[1, "q1"]]))).rejects.toThrow("database went away");
    expect(rows).toHaveLength(1);
    expect(rows[0].storageKey).toBe(earlierKey);
    expect(files.size).toBe(1);
  });
});
