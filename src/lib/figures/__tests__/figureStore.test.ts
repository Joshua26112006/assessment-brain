import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- a small fake of the two tables and the file store these functions touch ----
interface Row { id: string; assessmentId: string; storageKey: string; source: string; questionId: string | null }
const rows: Row[] = [];
const files = new Map<string, Buffer>();
let failOnCreateNumber = -1;
let created = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    questionFigure: {
      findMany: async ({ where }: { where: { assessmentId: string; source?: string } }) =>
        rows.filter((r) => r.assessmentId === where.assessmentId && (!where.source || r.source === where.source)).map((r) => ({ id: r.id, storageKey: r.storageKey })),
      create: async ({ data }: { data: Omit<Row, "id"> }) => {
        created++;
        if (created === failOnCreateNumber) throw new Error("database went away");
        const row = { id: `f${rows.length + 1}-${created}`, ...data };
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
vi.mock("@/lib/storage/questionPapers", () => ({ readQuestionPaperPageContent: async () => null }));

import { sharesNumber, storeDetectedFigures } from "@/lib/figures/figureStore";
import { MAX_FIGURE_SIDE, prepareFigureUpload } from "@/lib/storage/questionFigures";

const figure = (questionNumber: number | null) => ({
  pageNumber: 1, left: 0.1, top: 0.2, width: 0.3, height: 0.2, png: Buffer.from(`png-${questionNumber}`), pixelWidth: 10, pixelHeight: 10, questionNumber,
});
const detection = (numbers: Array<number | null>) => ({ figures: numbers.map(figure), pagesRead: 1, notes: [] });

describe("sharesNumber", () => {
  it("is true for parts of the same numbered question", () => {
    expect(sharesNumber("1(a)", "1(b)")).toBe(true);
    expect(sharesNumber("3(b)(ii)", "3(a)")).toBe(true);
    expect(sharesNumber("2", "2(a)")).toBe(true);
  });

  it("is false for different questions or no label", () => {
    expect(sharesNumber("1(a)", "2(a)")).toBe(false);
    expect(sharesNumber(null, "1(a)")).toBe(false);
    expect(sharesNumber("1(a)", undefined)).toBe(false);
  });
});

describe("storeDetectedFigures", () => {
  beforeEach(() => {
    rows.length = 0;
    files.clear();
    created = 0;
    failOnCreateNumber = -1;
  });

  it("stores each figure with the question it follows, and leaves a figure that follows none unassigned", async () => {
    const count = await storeDetectedFigures("a1", detection([1, null]), new Map([[1, "q1"]]));
    expect(count).toBe(2);
    expect(rows.map((r) => r.questionId)).toEqual(["q1", null]);
    expect(files.size).toBe(2);
  });

  it("replaces an earlier finding only after the new one is safely stored", async () => {
    await storeDetectedFigures("a1", detection([1]), new Map([[1, "q1"]]));
    const earlierKey = rows[0].storageKey;
    await storeDetectedFigures("a1", detection([1, 1]), new Map([[1, "q1"]]));
    expect(rows).toHaveLength(2);
    expect(files.has(earlierKey)).toBe(false);
    expect(files.size).toBe(2);
  });

  it("keeps the earlier figures and leaves no half-written ones when the new store fails part-way", async () => {
    await storeDetectedFigures("a1", detection([1]), new Map([[1, "q1"]]));
    const earlierKey = rows[0].storageKey;
    failOnCreateNumber = created + 2; // the second new figure fails
    await expect(storeDetectedFigures("a1", detection([1, 1, 1]), new Map([[1, "q1"]]))).rejects.toThrow("database went away");
    expect(rows).toHaveLength(1);
    expect(rows[0].storageKey).toBe(earlierKey);
    expect(files.size).toBe(1);
  });
});

describe("prepareFigureUpload", () => {
  it("turns a picture into a PNG at a usable size", async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const result = await prepareFigureUpload(jpeg);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.widthPx).toBe(MAX_FIGURE_SIDE);
      expect(result.heightPx).toBe(800);
      expect((await sharp(result.png).metadata()).format).toBe("png");
    }
  });

  it("does not enlarge a small picture", async () => {
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    const result = await prepareFigureUpload(png);
    expect(result.ok && result.widthPx).toBe(200);
  });

  it("refuses an empty file, text pretending to be a picture, and a file that is too large", async () => {
    expect((await prepareFigureUpload(Buffer.alloc(0))).ok).toBe(false);
    expect((await prepareFigureUpload(Buffer.from("not a picture at all"))).ok).toBe(false);
    expect((await prepareFigureUpload(Buffer.alloc(9 * 1024 * 1024, 1))).ok).toBe(false);
  });

  it("refuses a file with a picture header and a broken body", async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("garbage")]);
    expect((await prepareFigureUpload(broken)).ok).toBe(false);
  });
});
