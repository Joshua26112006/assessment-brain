import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/callStructured", () => ({ callStructuredAi: vi.fn(), callStructuredAiWithContent: vi.fn() }));

import { callStructuredAi } from "@/lib/ai/callStructured";
import { readingFromCorrectedText, structureTranscription } from "@/lib/structuredCorrection/textReading";

const call = vi.mocked(callStructuredAi);

describe("readingFromCorrectedText", () => {
  it("keeps the teacher's text word for word, mistakes included", () => {
    const reading = readingFromCorrectedText({
      questionNumber: 3,
      text: "mean = 2 + 3 + 4 / 3 = 5\nanswer 5",
      reply: { segments: [{ steps: ["mean = 2 + 3 + 4 / 3 = 5"], variables: { mean: "5" }, studentAnswer: "5", language: "English", structureConfidence: "high", problemType: "mean" }] },
    });
    expect(reading.transcription).toBe("mean = 2 + 3 + 4 / 3 = 5\nanswer 5");
    expect(reading.attempted).toBe(true);
    expect(reading.studentAnswer?.raw).toBe("5");
    expect(reading.variables.mean.raw).toBe("5");
    expect(reading.problemType).toBe("mean");
    expect(reading.segments?.[0]).toMatchObject({ status: "active", marked: true, page: 1 });
  });

  it("throws away a step, value or final answer that is not in the typed text", () => {
    const reading = readingFromCorrectedText({
      questionNumber: 1,
      text: "x = 4",
      reply: { segments: [{ steps: ["x = 4", "x = 4 so the answer is 9"], variables: { x: "4", y: "7" }, studentAnswer: "9", language: "English", structureConfidence: "high", problemType: "algebra" }] },
    });
    expect(reading.steps).toEqual(["x = 4"]);
    expect(Object.keys(reading.variables)).toEqual(["x"]);
    expect(reading.studentAnswer).toBeNull();
  });

  it("ignores an unusable reply and still marks from the text", () => {
    const reading = readingFromCorrectedText({ questionNumber: 2, text: "B", reply: "nonsense" });
    expect(reading.transcription).toBe("B");
    expect(reading.attempted).toBe(true);
    expect(reading.steps).toEqual([]);
    expect(reading.studentAnswer).toBeNull();
  });

  it("is not attempted when nothing is typed", () => {
    const reading = readingFromCorrectedText({ questionNumber: 2, text: "   ", reply: null });
    expect(reading.attempted).toBe(false);
    expect(reading.transcription).toBe("");
  });

  it("flags a drawing the teacher wrote as [diagram], and not otherwise", () => {
    expect(readingFromCorrectedText({ questionNumber: 1, text: "[diagram] AB = 5", reply: null }).containsDiagram).toBe(true);
    expect(readingFromCorrectedText({ questionNumber: 1, text: "AB = 5", reply: { segments: [{ containsDiagram: true }] } }).containsDiagram).toBe(false);
  });

  it("never lets the model's own idea of attempts or status change what is marked", () => {
    const reading = readingFromCorrectedText({
      questionNumber: 1,
      text: "7",
      reply: { segments: [{ status: "struck", replaced: true, twoAttempts: true, transcription: "something else" }] },
    });
    expect(reading.transcription).toBe("7");
    expect(reading.conflictingAttempts).toBe(false);
    expect(reading.segments?.[0].status).toBe("active");
  });

  it("keeps a non-English language so it still goes to the teacher", () => {
    const reading = readingFromCorrectedText({ questionNumber: 1, text: "उत्तर 5", reply: { segments: [{ language: "Hindi" }] } });
    expect(reading.languages).toEqual(["Hindi"]);
  });
});

describe("structureTranscription", () => {
  beforeEach(() => {
    call.mockReset();
    call.mockImplementation(async () => ({ segments: [] }));
  });

  it("sends only the teacher's text and the question, and returns the reading", async () => {
    call.mockResolvedValue({ segments: [{ steps: ["x = 4"], variables: { x: "4" }, studentAnswer: "4", language: "English", structureConfidence: "high", problemType: "algebra" }] });
    const outcome = await structureTranscription({ questionNumber: 1, label: null, questionText: "Solve x + 1 = 5", text: "x = 4" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.reading.studentAnswer?.raw).toBe("4");
    expect(call.mock.calls[0][0].userPrompt).toContain("x = 4");
    expect(call.mock.calls[0][0].userPrompt).toContain("Solve x + 1 = 5");
  });

  it("makes no model call for empty text", async () => {
    const outcome = await structureTranscription({ questionNumber: 1, label: null, questionText: "Q", text: "" });
    expect(call).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.reading.attempted).toBe(false);
  });

  it("fails cleanly, without throwing, when the model call fails", async () => {
    call.mockImplementation(async () => { throw new Error("boom"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await structureTranscription({ questionNumber: 1, label: null, questionText: "Q", text: "5" });
    expect(outcome.ok).toBe(false);
  });
});
