import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTeacherApiSession } from "@/lib/api-session";
import { findOwnedSubmissionForTeacher } from "@/lib/answerSheetAccess";

/**
 * Read-only listing of a submission's answer-sheet pages, scoped to
 * assessments the requesting teacher actually owns.
 *
 * Deliberately minimal: this phase adds no teacher-facing viewer UI (that's
 * later, once pages carry real evaluated content) — this endpoint exists so
 * teacher-side ownership scoping can be exercised and verified now, on the
 * same infrastructure the eventual viewer will call.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { submissionId } = await params;

  const submission = await findOwnedSubmissionForTeacher(submissionId, session.session.user.id);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const pages = await prisma.answerSheetPage.findMany({
    where: { submissionId },
    orderBy: { pageNumber: "asc" },
    select: {
      id: true,
      pageNumber: true,
      originalFilename: true,
      mimeType: true,
      fileSizeBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ pages });
}
