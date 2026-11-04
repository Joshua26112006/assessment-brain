import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-session", () => ({ requireStudentApiSession: vi.fn() }));
vi.mock("@/lib/answerSheetAccess", () => ({
  findOwnedAnswerSheetPageForStudent: vi.fn(),
  isAnswerSheetEditableStatus: vi.fn(),
}));
vi.mock("@/lib/storage/answerSheets", () => ({
  readAnswerSheetPageContent: vi.fn(),
  deleteAnswerSheetPage: vi.fn(),
}));

import { requireStudentApiSession } from "@/lib/api-session";
import { findOwnedAnswerSheetPageForStudent } from "@/lib/answerSheetAccess";
import { readAnswerSheetPageContent } from "@/lib/storage/answerSheets";
import { GET } from "../route";

const session = vi.mocked(requireStudentApiSession);
const findPage = vi.mocked(findOwnedAnswerSheetPageForStudent);
const readFile = vi.mocked(readAnswerSheetPageContent);

function pageRow(releasedAt: Date | null) {
  return {
    id: "p1",
    storageKey: "sub1/original-1.png",
    annotatedStorageKey: "sub1/annotated-1.jpg",
    mimeType: "image/png",
    originalFilename: "page1.png",
    submission: { id: "sub1", status: "COMPLETED", releasedAt },
  };
}

async function request(url: string) {
  return GET(new Request(url), { params: Promise.resolve({ submissionId: "sub1", pageId: "p1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ ok: true, session: { user: { id: "student1" } } } as never);
  readFile.mockResolvedValue(Buffer.from("image-bytes"));
});

describe("student page route — a marked-up page is released with the marks, not before", () => {
  it("serves the student's own unmarked page when the marked copy is requested before release", async () => {
    findPage.mockResolvedValue(pageRow(null) as never);

    const response = await request("http://localhost/api/x?annotated=1");

    expect(response.status).toBe(200);
    expect(readFile).toHaveBeenCalledWith("sub1/original-1.png");
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves the marked-up copy once a teacher has released the submission", async () => {
    findPage.mockResolvedValue(pageRow(new Date("2026-11-04T10:00:00Z")) as never);

    const response = await request("http://localhost/api/x?annotated=1");

    expect(readFile).toHaveBeenCalledWith("sub1/annotated-1.jpg");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("serves the original page when no marked copy is requested, released or not", async () => {
    findPage.mockResolvedValue(pageRow(new Date("2026-11-04T10:00:00Z")) as never);
    await request("http://localhost/api/x");
    expect(readFile).toHaveBeenLastCalledWith("sub1/original-1.png");
  });

  it("returns 404 for a page that is not the student's", async () => {
    findPage.mockResolvedValue(null as never);
    const response = await request("http://localhost/api/x?annotated=1");
    expect(response.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });
});
