import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Crop { id: string; submissionId: string; questionId: string | null; storageKey: string; pageNumber: number; confident: boolean; adjustedByTeacher: boolean; widthPx: number; heightPx: number; foundByInk: boolean; foundByModel: boolean }
const state = {
  confirmedAt: null as Date | null,
  crops: [] as Crop[],
  files: new Map<string, Buffer>(),
  failNextCreate: false,
  page: null as Buffer | null,
};
let counter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    submission: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "s1" ? { id: "s1", confirmedAt: state.confirmedAt, assessmentId: "a1" } : null) },
    question: { findFirst: async ({ where }: { where: { id: string } }) => (where.id === "q1" ? { id: "q1" } : null) },
    answerSheetPage: { findFirst: async ({ where }: { where: { pageNumber: number } }) => (where.pageNumber === 2 ? { storageKey: "page-2", mimeType: "image/png" } : null) },
    diagramCrop: {
      // A snapshot, as a real database returns: a later update must not change what was already read.
      findFirst: async ({ where }: { where: { id: string } }) => {
        const row = state.crops.find((c) => c.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: Omit<Crop, "id"> }) => {
        if (state.failNextCreate) throw new Error("database went away");
        const row = { id: `new${++counter}`, ...data };
        state.crops.push(row as Crop);
        return { id: row.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Crop> }) => {
        const row = state.crops.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return { id: row.id };
      },
      delete: async ({ where }: { where: { id: string } }) => void state.crops.splice(state.crops.findIndex((c) => c.id === where.id), 1),
    },
  },
}));
vi.mock("@/lib/storage/answerSheets", () => ({ readAnswerSheetPageContent: async () => state.page }));
vi.mock("@/lib/storage/questionFigures", () => ({
  newDiagramCropKey: (submissionId: string) => `submissions/${submissionId}/crop-${++counter}.png`,
  writeFigureFile: async (key: string, buffer: Buffer) => void state.files.set(key, buffer),
  removeFigureFile: async (key: string) => void state.files.delete(key),
}));

import { removeTeacherCrop, saveTeacherCrop } from "@/lib/figures/diagramCropAdmin";

const box = { left: 0.1, top: 0.2, width: 0.5, height: 0.25 };
const base = { teacherId: "t1", submissionId: "s1", questionId: "q1", cropId: null, pageNumber: 2, box };

describe("diagram crop corrections by the teacher", () => {
  beforeEach(async () => {
    state.confirmedAt = null;
    state.crops = [];
    state.files.clear();
    state.failNextCreate = false;
    counter = 0;
    state.page = await sharp({ create: { width: 1000, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer();
  });

  it("cuts a new crop from the original page at the page's own resolution, and records it as the teacher's", async () => {
    const result = await saveTeacherCrop(base);
    expect(result.ok).toBe(true);
    expect(state.crops).toHaveLength(1);
    expect(state.crops[0]).toMatchObject({ questionId: "q1", pageNumber: 2, confident: true, adjustedByTeacher: true, foundByInk: false, foundByModel: false });
    const meta = await sharp([...state.files.values()][0]).metadata();
    expect([meta.width, meta.height]).toEqual([500, 200]);
    expect([state.crops[0].widthPx, state.crops[0].heightPx]).toEqual([500, 200]);
  });

  it("replaces the box of an existing crop and removes its old file", async () => {
    state.files.set("old-key", Buffer.from("old"));
    state.crops.push({ id: "c1", submissionId: "s1", questionId: "q1", storageKey: "old-key", pageNumber: 2, confident: false, adjustedByTeacher: false, widthPx: 1, heightPx: 1, foundByInk: true, foundByModel: false });
    const result = await saveTeacherCrop({ ...base, cropId: "c1" });
    expect(result).toMatchObject({ ok: true, cropId: "c1" });
    expect(state.crops).toHaveLength(1);
    expect(state.crops[0]).toMatchObject({ confident: true, adjustedByTeacher: true });
    expect(state.files.has("old-key")).toBe(false);
    expect(state.files.size).toBe(1);
  });

  it("refuses once the marks are confirmed, and changes nothing", async () => {
    state.confirmedAt = new Date();
    const result = await saveTeacherCrop(base);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("confirmed");
    expect(state.crops).toHaveLength(0);
    expect(state.files.size).toBe(0);
  });

  it("refuses a box that is not usable before touching any file", async () => {
    const result = await saveTeacherCrop({ ...base, box: { left: 0.1, top: 0.1, width: 0.001, height: 0.5 } });
    expect(result.ok).toBe(false);
    expect(state.files.size).toBe(0);
  });

  it("refuses an unknown submission, question, crop or page", async () => {
    expect((await saveTeacherCrop({ ...base, submissionId: "other" })).ok).toBe(false);
    expect((await saveTeacherCrop({ ...base, questionId: "other" })).ok).toBe(false);
    expect((await saveTeacherCrop({ ...base, cropId: "nope" })).ok).toBe(false);
    expect((await saveTeacherCrop({ ...base, pageNumber: 9 })).ok).toBe(false);
    expect(state.files.size).toBe(0);
  });

  it("leaves no stray file when the database write fails", async () => {
    state.failNextCreate = true;
    await expect(saveTeacherCrop(base)).rejects.toThrow("database went away");
    expect(state.files.size).toBe(0);
    expect(state.crops).toHaveLength(0);
  });

  it("removes a crop and its file, but not once confirmed", async () => {
    state.files.set("k", Buffer.from("x"));
    state.crops.push({ id: "c1", submissionId: "s1", questionId: "q1", storageKey: "k", pageNumber: 2, confident: true, adjustedByTeacher: false, widthPx: 1, heightPx: 1, foundByInk: true, foundByModel: true });
    state.confirmedAt = new Date();
    expect((await removeTeacherCrop({ teacherId: "t1", submissionId: "s1", cropId: "c1" })).ok).toBe(false);
    expect(state.crops).toHaveLength(1);
    state.confirmedAt = null;
    expect((await removeTeacherCrop({ teacherId: "t1", submissionId: "s1", cropId: "c1" })).ok).toBe(true);
    expect(state.crops).toHaveLength(0);
    expect(state.files.size).toBe(0);
  });
});
