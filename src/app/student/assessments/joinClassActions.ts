"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStudentSession } from "@/lib/require-student";
import { normalizeJoinCode } from "@/lib/classJoinCode";

export type JoinClassState = { error?: string; success?: string };

/**
 * Enrols the signed-in student in a class from its join code.
 *
 * A student's assessments are gated on class membership
 * (src/lib/student-assessment-access.ts), and until now nothing in the app
 * could create that membership — a student who registered could never see any
 * assessment at all. This is the path that fixes that.
 *
 * The code is the only credential, so it is never echoed back in an error and
 * a wrong code says only that no class matched: confirming that a code exists
 * but "isn't yours" would turn this into an oracle for discovering real codes.
 */
export async function joinClassWithCode(
  _prevState: JoinClassState,
  formData: FormData,
): Promise<JoinClassState> {
  const session = await requireStudentSession();

  const code = normalizeJoinCode(String(formData.get("joinCode") ?? ""));
  if (!code) {
    return { error: "Enter the class code your teacher gave you." };
  }

  const target = await prisma.class.findUnique({
    where: { joinCode: code },
    select: { id: true, name: true },
  });
  if (!target) {
    return { error: "That code didn't match any class. Check it with your teacher and try again." };
  }

  const existing = await prisma.classMembership.findUnique({
    where: { classId_studentId: { classId: target.id, studentId: session.user.id } },
    select: { id: true },
  });
  if (existing) {
    return { success: `You're already in ${target.name}.` };
  }

  // upsert, not create: two rapid submissions of the same code would otherwise
  // race into a unique-constraint error the student would see as a failure,
  // when in fact they are already enrolled exactly as they wanted.
  await prisma.classMembership.upsert({
    where: { classId_studentId: { classId: target.id, studentId: session.user.id } },
    create: { classId: target.id, studentId: session.user.id },
    update: {},
  });

  revalidatePath("/student/assessments");
  revalidatePath("/student/dashboard");

  return { success: `You've joined ${target.name}. Any assessments for this class will appear below.` };
}
