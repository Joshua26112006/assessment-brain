import { NextResponse } from "next/server";
import { requireTeacherApiSession } from "@/lib/api-session";
import { findOwnedQuestionPaperPageForTeacher } from "@/lib/questionPaperAccess";
import { readQuestionPaperPageContent } from "@/lib/storage/questionPapers";

/**
 * Secure single-page read access for the owning teacher — the question-paper
 * counterpart to the student answer-sheet page GET route. No write/delete
 * here; removing a page happens only by deleting the whole draft (see
 * ../../route.ts DELETE) since a question paper's pages aren't independently
 * manageable the way answer-sheet pages are.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { id: assessmentId, pageId } = await params;

  const page = await findOwnedQuestionPaperPageForTeacher(assessmentId, pageId, session.session.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const content = await readQuestionPaperPageContent(page.storageKey);
  if (!content) {
    return NextResponse.json({ error: "This page's file is unavailable." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": page.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(page.originalFilename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
