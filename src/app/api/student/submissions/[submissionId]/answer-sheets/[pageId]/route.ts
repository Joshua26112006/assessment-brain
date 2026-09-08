import { NextResponse } from "next/server";
import { requireStudentApiSession } from "@/lib/api-session";
import { findOwnedAnswerSheetPageForStudent, isAnswerSheetEditableStatus } from "@/lib/answerSheetAccess";
import { deleteAnswerSheetPage, readAnswerSheetPageContent } from "@/lib/storage/answerSheets";

/**
 * Secure single-page access and deletion for the owning student.
 *
 * Every request re-derives ownership from the authenticated session plus
 * both path segments (submissionId AND pageId) — a student can never
 * reach another student's page by guessing an id, and a 404 here is
 * indistinguishable from "this page genuinely doesn't exist", matching the
 * app's existing notFound()-style convention for owned resources.
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
  const session = await requireStudentApiSession();
  if (!session.ok) return session.response;
  const { submissionId, pageId } = await params;

  const page = await findOwnedAnswerSheetPageForStudent(submissionId, pageId, session.session.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  const requested = resolveRequestedPage(request, page);
  const content = await readAnswerSheetPageContent(requested.storageKey);
  if (!content) {
    // The database row exists but the file is missing — a storage-layer
    // inconsistency, not an authorization failure. Reported plainly rather
    // than as a generic 404 so it's distinguishable in logs/monitoring
    // later, without revealing any storage detail to the client.
    return NextResponse.json({ error: "This page's file is unavailable." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": requested.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(page.originalFilename)}"`,
      // Private, never cached by a shared cache — this is a student's own
      // exam answer, never a publicly cacheable asset.
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ submissionId: string; pageId: string }> },
) {
  const session = await requireStudentApiSession();
  if (!session.ok) return session.response;
  const { submissionId, pageId } = await params;

  const page = await findOwnedAnswerSheetPageForStudent(submissionId, pageId, session.session.user.id);
  if (!page) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }
  if (!isAnswerSheetEditableStatus(page.submission.status)) {
    return NextResponse.json(
      { error: "Pages can only be removed while the submission is still in progress." },
      { status: 409 },
    );
  }

  await deleteAnswerSheetPage(page);
  return NextResponse.json({ success: true });
}
