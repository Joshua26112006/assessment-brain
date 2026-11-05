import { describe, expect, it } from "vitest";
import { routeAnswer } from "@/lib/structuredCorrection/routing";
import type { ReconciledReading } from "@/types/structuredCorrection";

const reading = (over: Partial<ReconciledReading> = {}): ReconciledReading => ({
  questionNumber: 1,
  transcription: "W = F x d",
  attempted: true,
  agreementConfidence: "high",
  problemType: "unknown",
  steps: [],
  variables: {},
  studentAnswer: null,
  structureConfidence: "high",
  languages: ["English"],
  segments: [{ page: 1, status: "active", marked: true, text: "W = F x d" }],
  ...over,
});

describe("routeAnswer", () => {
  it("a diagram question is the teacher's: no AI mark, whatever was read", () => {
    expect(routeAnswer({ answerType: "DIAGRAM", reading: reading() })).toEqual({ kind: "TEACHER_ONLY_DIAGRAM" });
    expect(routeAnswer({ answerType: "DIAGRAM", reading: null })).toEqual({ kind: "TEACHER_ONLY_DIAGRAM" });
  });

  it("an answer written in another language is the teacher's: D7, English only", () => {
    expect(routeAnswer({ answerType: "DESCRIPTIVE", reading: reading({ languages: ["Hindi"] }) })).toEqual({ kind: "CANNOT_READ_LANGUAGE", languages: ["Hindi"] });
    expect(routeAnswer({ answerType: "SHORT_TEXT", reading: reading({ languages: ["English", "Tamil"] }) })).toEqual({ kind: "CANNOT_READ_LANGUAGE", languages: ["Tamil"] });
  });

  it("a language is only held against an answer that was actually written", () => {
    const route = routeAnswer({ answerType: "DESCRIPTIVE", reading: reading({ attempted: false, languages: ["Hindi"] }) });
    expect(route.kind).toBe("MARK");
  });

  it("an ordinary English answer is marked, with nothing for the teacher to check", () => {
    expect(routeAnswer({ answerType: "NUMERIC", reading: reading() })).toEqual({ kind: "MARK", extraReasons: [] });
  });

  it("two live attempts are marked but the teacher is told", () => {
    const route = routeAnswer({ answerType: "NUMERIC", reading: reading({ conflictingAttempts: true }) });
    expect(route).toMatchObject({ kind: "MARK" });
    expect(route.kind === "MARK" && route.extraReasons.join(" ")).toMatch(/Two different answers/);
  });

  it("a diagram inside an otherwise text answer: the text is marked and the teacher is told to check the diagram's marks", () => {
    const route = routeAnswer({ answerType: "DESCRIPTIVE", reading: reading({ containsDiagram: true }) });
    expect(route.kind === "MARK" && route.extraReasons.join(" ")).toMatch(/diagram/);
  });

  it("an essay is always the teacher's to check", () => {
    const route = routeAnswer({ answerType: "ESSAY", reading: reading() });
    expect(route.kind === "MARK" && route.extraReasons).toContain("Long answers are always checked by you.");
  });

  it("a lone crossed-out answer is marked but flagged", () => {
    const route = routeAnswer({ answerType: "NUMERIC", reading: reading({ segments: [{ page: 1, status: "struck", marked: true, text: "x = 4" }] }) });
    expect(route.kind === "MARK" && route.extraReasons.join(" ")).toMatch(/crossed out/);
  });

  it("a replaced crossed-out answer is ignored silently: the replacement is what is marked", () => {
    const route = routeAnswer({
      answerType: "NUMERIC",
      reading: reading({
        segments: [
          { page: 1, status: "struck", marked: false, text: "x = 4" },
          { page: 1, status: "active", marked: true, text: "x = 5" },
        ],
      }),
    });
    expect(route).toEqual({ kind: "MARK", extraReasons: [] });
  });

  it("rough work alongside the answer is ignored silently", () => {
    const route = routeAnswer({
      answerType: "NUMERIC",
      reading: reading({ segments: [{ page: 1, status: "active", marked: true, text: "x" }, { page: 1, status: "rough", marked: false, text: "2 x 3" }] }),
    });
    expect(route).toEqual({ kind: "MARK", extraReasons: [] });
  });

  it("a reading that is missing altogether does not crash routing", () => {
    expect(routeAnswer({ answerType: "NUMERIC", reading: null })).toEqual({ kind: "MARK", extraReasons: [] });
  });
});
