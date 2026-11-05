import { describe, expect, it } from "vitest";
import { isMarked, nonEnglishLanguages, parsePageResponse, stitchPass, type PageSegment } from "@/lib/structuredCorrection/pageSegments";

const VALID = new Set([1, 2, 3]);

const seg = (over: Partial<PageSegment> & { questionNumber: number; text: string }): PageSegment => ({
  status: "active",
  replaced: false,
  steps: [],
  variables: {},
  studentAnswer: null,
  containsDiagram: false,
  language: "English",
  twoAttempts: false,
  structureConfidence: "high",
  problemType: "unknown",
  ...over,
});

describe("parsePageResponse", () => {
  it("reads a segment with its status and the fields marking needs", () => {
    const [s] = parsePageResponse(
      { segments: [{ questionNumber: 1, status: "struck", replaced: true, transcription: " x = 3 ", steps: ["a"], variables: { x: "3" }, studentAnswer: "3", language: "English", structureConfidence: "medium" }] },
      VALID,
    );
    expect(s).toMatchObject({ questionNumber: 1, status: "struck", replaced: true, text: "x = 3", steps: ["a"], structureConfidence: "medium" });
    expect(s.variables.x).toEqual({ raw: "3", parsed: 3 });
    expect(s.studentAnswer).toEqual({ raw: "3", parsed: 3 });
  });

  it("treats an unlabelled segment as live, so only an explicit label ever removes work from marking", () => {
    expect(parsePageResponse({ segments: [{ questionNumber: 1, transcription: "x" }] }, VALID)[0].status).toBe("active");
    expect(parsePageResponse({ segments: [{ questionNumber: 1, transcription: "x", status: "weird" }] }, VALID)[0].status).toBe("active");
  });

  it("ignores a question not on this paper, an empty segment, and anything malformed", () => {
    expect(parsePageResponse({ segments: [{ questionNumber: 9, transcription: "x" }, { questionNumber: 1, transcription: "  " }, null, 3, { transcription: "no number" }] }, VALID)).toEqual([]);
    expect(parsePageResponse(null, VALID)).toEqual([]);
    expect(parsePageResponse({ segments: "no" }, VALID)).toEqual([]);
  });

  it("defaults the language to English, and the confidence to low when missing", () => {
    const [s] = parsePageResponse({ segments: [{ questionNumber: 1, transcription: "x" }] }, VALID);
    expect(s.language).toBe("English");
    expect(s.structureConfidence).toBe("low");
  });
});

describe("isMarked — what the strike-through rules decide", () => {
  it("live text is marked", () => expect(isMarked({ status: "active", replaced: false })).toBe(true));
  it("struck and replaced is not marked", () => expect(isMarked({ status: "struck", replaced: true })).toBe(false));
  it("struck and NOT replaced is marked: it is all the student gave", () => expect(isMarked({ status: "struck", replaced: false })).toBe(true));
  it("rough work is never marked", () => {
    expect(isMarked({ status: "rough", replaced: false })).toBe(false);
    expect(isMarked({ status: "rough", replaced: true })).toBe(false);
  });
});

describe("stitchPass", () => {
  it("joins one answer that runs across pages, in page order", () => {
    const stitched = stitchPass([[seg({ questionNumber: 1, text: "Part one of the essay" })], [seg({ questionNumber: 1, text: "contd. part two" })]], VALID);
    expect(stitched.get(1)?.transcription).toBe("Part one of the essay\ncontd. part two");
    expect(stitched.get(1)?.segments.map((s) => s.page)).toEqual([1, 2]);
  });

  it("a question with no segment anywhere is absent: it was not answered", () => {
    expect(stitchPass([[seg({ questionNumber: 1, text: "x" })]], VALID).has(2)).toBe(false);
  });

  it("a struck answer that was replaced is shown to the teacher but not marked", () => {
    const stitched = stitchPass(
      [[seg({ questionNumber: 1, text: "x = 4", status: "struck", replaced: true, variables: { x: { raw: "4", parsed: 4 } } }), seg({ questionNumber: 1, text: "x = 5", variables: { x: { raw: "5", parsed: 5 } } })]],
      VALID,
    );
    const q = stitched.get(1)!;
    expect(q.transcription).toBe("x = 5");
    expect(q.variables.x.raw).toBe("5");
    expect(q.segments).toHaveLength(2);
    expect(q.segments[0]).toMatchObject({ status: "struck", marked: false });
    expect(q.segments[1]).toMatchObject({ status: "active", marked: true });
  });

  it("a struck answer with no replacement is the student's only answer, so it is marked", () => {
    const q = stitchPass([[seg({ questionNumber: 1, text: "x = 4", status: "struck", replaced: false })]], VALID).get(1)!;
    expect(q.attempted).toBe(true);
    expect(q.transcription).toBe("x = 4");
  });

  it("rough work in the margin is never marked, and a question with ONLY rough work is not attempted", () => {
    const q = stitchPass([[seg({ questionNumber: 1, text: "2 x 3 = 6", status: "rough" })]], VALID).get(1)!;
    expect(q.attempted).toBe(false);
    expect(q.transcription).toBe("");
    expect(q.segments[0]).toMatchObject({ status: "rough", marked: false });
  });

  it("takes the final answer from the last marked piece that has one, and merges variables with later pieces winning", () => {
    const q = stitchPass(
      [
        [seg({ questionNumber: 1, text: "a", variables: { m: { raw: "2", parsed: 2 } }, studentAnswer: { raw: "7", parsed: 7 } })],
        [seg({ questionNumber: 1, text: "b", variables: { m: { raw: "3", parsed: 3 }, g: { raw: "10", parsed: 10 } }, studentAnswer: { raw: "9", parsed: 9 } })],
      ],
      VALID,
    ).get(1)!;
    expect(q.studentAnswer?.raw).toBe("9");
    expect(q.variables.m.raw).toBe("3");
    expect(Object.keys(q.variables).sort()).toEqual(["g", "m"]);
  });

  it("an answer written only in a struck-and-replaced piece does not supply the final answer", () => {
    const q = stitchPass(
      [[seg({ questionNumber: 1, text: "old", status: "struck", replaced: true, studentAnswer: { raw: "4", parsed: 4 } }), seg({ questionNumber: 1, text: "new" })]],
      VALID,
    ).get(1)!;
    expect(q.studentAnswer).toBeNull();
  });

  it("the structure confidence is the lowest among the marked pieces", () => {
    const q = stitchPass([[seg({ questionNumber: 1, text: "a", structureConfidence: "high" })], [seg({ questionNumber: 1, text: "b", structureConfidence: "low" })]], VALID).get(1)!;
    expect(q.structureConfidence).toBe("low");
  });

  it("reports a diagram anywhere in the answer, the languages written, and two live attempts", () => {
    const q = stitchPass(
      [[seg({ questionNumber: 1, text: "a", containsDiagram: true, language: "English" })], [seg({ questionNumber: 1, text: "b", language: "Hindi", twoAttempts: true })]],
      VALID,
    ).get(1)!;
    expect(q.containsDiagram).toBe(true);
    expect(q.languages).toEqual(["English", "Hindi"]);
    expect(q.conflictingAttempts).toBe(true);
  });

  it("two attempts only count when the piece that reported them is marked", () => {
    const q = stitchPass([[seg({ questionNumber: 1, text: "a" }), seg({ questionNumber: 1, text: "b", status: "rough", twoAttempts: true })]], VALID).get(1)!;
    expect(q.conflictingAttempts).toBe(false);
  });

  it("numbers and symbols only ('none') are not a language", () => {
    expect(stitchPass([[seg({ questionNumber: 1, text: "2+2=4", language: "none" })]], VALID).get(1)?.languages).toEqual([]);
  });

  it("ignores a segment for a question that is not on the paper", () => {
    expect(stitchPass([[seg({ questionNumber: 9, text: "x" })]], VALID).size).toBe(0);
  });

  it("an empty paper stitches to nothing", () => {
    expect(stitchPass([], VALID).size).toBe(0);
    expect(stitchPass([[]], VALID).size).toBe(0);
  });
});

describe("nonEnglishLanguages", () => {
  it("anything other than English is listed, case-insensitively; mixed writing counts", () => {
    expect(nonEnglishLanguages(["English", "Hindi"])).toEqual(["Hindi"]);
    expect(nonEnglishLanguages(["english"])).toEqual([]);
    expect(nonEnglishLanguages(["Hindi", "Tamil"])).toEqual(["Hindi", "Tamil"]);
    expect(nonEnglishLanguages([])).toEqual([]);
  });
});
