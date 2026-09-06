import { NextResponse } from "next/server";
import { requireTeacherApiSession } from "@/lib/api-session";
import { findOwnedAnswerSheetPageForTeacher } from "@/lib/answerSheetAccess";
import { readAnswerSheetPageContent } from "@/lib/storage/answerSheets";

/**
 * Secure single-page read access for a teacher, scoped to assessments they
 * own. No delete/write operations here — a teacher reviews a student's
 * answer sheet, they never modify it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string; pageId: string }> },
) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { submissionId, pageId } = await params;

  const page = await findOwnedAnswerSheetPageForTeacher(submissionId, pageId, session.session.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const content = await readAnswerSheetPageContent(page.storageKey);
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
