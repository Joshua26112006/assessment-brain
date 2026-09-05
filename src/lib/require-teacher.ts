import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Defense-in-depth session check for Server Components/Actions.
 *
 * `proxy.ts` already blocks non-teachers from reaching `/teacher/*` at the
 * request level, but Next.js's own guidance is explicit: don't rely on
 * proxy/middleware alone — verify the session again as close to the data
 * access as possible, since Server Actions can be invoked directly and
 * aren't necessarily covered by every route-level check.
 */
export async function requireTeacherSession() {
  const session = await auth();
  if (!session || session.user.role !== "TEACHER") {
    redirect("/login");
  }
  return session;
}
