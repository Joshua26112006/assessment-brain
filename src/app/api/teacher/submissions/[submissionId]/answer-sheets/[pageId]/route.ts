import { NextResponse } from "next/server";
import { requireTeacherApiSession } from "@/lib/api-session";
import { findOwnedAnswerSheetPageForTeacher } from "@/lib/answerSheetAccess";
import { readAnswerSheetPageContent } from "@/lib/storage/answerSheets";

/**
 * Secure single-page read access for a teacher, scoped to assessments they
 * own. No delete/write operations here — a teacher reviews a student's
 * answer sheet, they never modify it.
 */
/**
 * Serves the marked-up copy when `?annotated=1` is requested and one exists,
 * falling back to the original page otherwise — a submission that was never
 * annotated, or a page the annotator could not handle, still returns the
 * student's own work rather than a 404.
 */
function resolveRequestedPage(
  request: Request,
  page: { storageKey: string; annotatedStorageKey: string | null; mimeType: string },
): { storageKey: string; mimeType: string } {
  const wantsAnnotated = new URL(request.url).searchParams.get("annotated") === "1";
  if (wantsAnnotated && page.annotatedStorageKey) {
    // Annotated copies are always written as JPEG (see the annotation module).
    return { storageKey: page.annotatedStorageKey, mimeType: "image/jpeg" };
  }
  return { storageKey: page.storageKey, mimeType: page.mimeType };
}

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

  const requested = resolveRequestedPage(request, page);
  const content = await readAnswerSheetPageContent(requested.storageKey);
  if (!content) {
    return NextResponse.json({ error: "This page's file is unavailable." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": requested.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(page.originalFilename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
