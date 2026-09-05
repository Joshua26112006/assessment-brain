import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Defense-in-depth session check for Server Components/Actions — mirrors
 * requireTeacherSession. `proxy.ts` already blocks non-students from
 * reaching `/student/*`, but Server Actions can be invoked directly, so the
 * session is re-verified here too.
 */
export async function requireStudentSession() {
  const session = await auth();
  if (!session || session.user.role !== "STUDENT") {
    redirect("/login");
  }
  return session;
}
