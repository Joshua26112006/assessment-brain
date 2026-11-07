import type { Prisma } from "@prisma/client";

/**
 * Stores the answer text a teacher typed to replace what the handwriting reader produced. The text the reader first
 * gave is kept (`originalText`, set only the first time) so the change can always be undone by reading the record, and
 * a TEACHER_TRANSCRIPTION event records who changed what. Runs inside the caller's transaction so the new text and
 * the new draft mark are stored together or not at all.
 */
export async function recordCorrectedText(
  tx: Prisma.TransactionClient,
  input: { responseId: string; submissionId: string; teacherId: string; text: string },
): Promise<void> {
  const row = await tx.questionResponse.findUnique({ where: { id: input.responseId }, select: { studentAnswer: true } });
  const current = (typeof row?.studentAnswer === "object" && row.studentAnswer !== null && !Array.isArray(row.studentAnswer)
    ? row.studentAnswer
    : {}) as Record<string, unknown>;
  const before = typeof current.text === "string" ? current.text : "";

  await tx.questionResponse.update({
    where: { id: input.responseId },
    data: {
      studentAnswer: {
        ...current,
        originalText: typeof current.originalText === "string" ? current.originalText : before,
        text: input.text,
        correctedByTeacher: true,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.markEvent.create({
    data: {
      kind: "TEACHER_TRANSCRIPTION",
      submissionId: input.submissionId,
      questionResponseId: input.responseId,
      actorId: input.teacherId,
      payload: { before, after: input.text },
    },
  });
}
