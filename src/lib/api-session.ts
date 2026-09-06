import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

/**
 * Session check for Route Handlers (JSON APIs).
 *
 * requireStudentSession/requireTeacherSession (src/lib/require-student.ts,
 * require-teacher.ts) do the same session+role check but call redirect(),
 * which is the right behaviour for a page and the wrong one for a JSON
 * endpoint — a fetch() call to an upload API should get a 401 response
 * body, not a redirect response. This mirrors their check rather than
 * reusing them directly, since /api/* routes get no proxy.ts coverage at
 * all (see proxy.ts's own matcher comment) and must fully self-authorize.
 */
async function requireApiSession(
  role: "STUDENT" | "TEACHER",
): Promise<{ ok: true; session: Session } | { ok: false; response: NextResponse }> {
  const session = await auth();
  if (!session || session.user.role !== role) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  return { ok: true, session };
}

export function requireStudentApiSession() {
  return requireApiSession("STUDENT");
}

export function requireTeacherApiSession() {
  return requireApiSession("TEACHER");
}
