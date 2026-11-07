import { describe, expect, it, vi } from "vitest";
import { recordCorrectedText } from "@/lib/assessment/correctedReading";

function fakeTx(studentAnswer: unknown) {
  return {
    questionResponse: { findUnique: vi.fn().mockResolvedValue({ studentAnswer }), update: vi.fn() },
    markEvent: { create: vi.fn() },
  };
}

describe("recordCorrectedText", () => {
  it("keeps what the reader first gave, stores the new text and records the change", async () => {
    const tx = fakeTx({ text: "B", sourcePages: [2] });
    await recordCorrectedText(tx as never, { responseId: "r1", submissionId: "s1", teacherId: "t1", text: "C" });
    expect(tx.questionResponse.update.mock.calls[0][0].data.studentAnswer).toEqual({ sourcePages: [2], originalText: "B", text: "C", correctedByTeacher: true });
    expect(tx.markEvent.create.mock.calls[0][0].data).toMatchObject({ kind: "TEACHER_TRANSCRIPTION", actorId: "t1", payload: { before: "B", after: "C" } });
  });

  it("never overwrites the first original when corrected twice", async () => {
    const tx = fakeTx({ text: "C", originalText: "B", correctedByTeacher: true });
    await recordCorrectedText(tx as never, { responseId: "r1", submissionId: "s1", teacherId: "t1", text: "D" });
    expect(tx.questionResponse.update.mock.calls[0][0].data.studentAnswer).toMatchObject({ originalText: "B", text: "D" });
    expect(tx.markEvent.create.mock.calls[0][0].data.payload).toEqual({ before: "C", after: "D" });
  });

  it("copes with an answer that has no stored object", async () => {
    const tx = fakeTx(null);
    await recordCorrectedText(tx as never, { responseId: "r1", submissionId: "s1", teacherId: "t1", text: "A" });
    expect(tx.questionResponse.update.mock.calls[0][0].data.studentAnswer).toMatchObject({ originalText: "", text: "A" });
  });
});
