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

  const content = await readAnswerSheetPageContent(page.storageKey);
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
      "Content-Type": page.mimeType,
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
