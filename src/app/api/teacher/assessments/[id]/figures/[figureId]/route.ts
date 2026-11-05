import { NextResponse } from "next/server";
import { requireTeacherApiSession } from "@/lib/api-session";
import { readFigureForTeacher } from "@/lib/figures/figureStore";

/** A figure's picture, for the teacher who owns the assessment. An id that is not theirs is the same as one that does not exist. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; figureId: string }> }) {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;
  const { id: assessmentId, figureId } = await params;

  const content = await readFigureForTeacher(assessmentId, figureId, session.session.user.id);
  if (!content) return NextResponse.json({ error: "Figure not found." }, { status: 404 });

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
}
