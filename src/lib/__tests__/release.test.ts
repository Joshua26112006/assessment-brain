import { describe, expect, it } from "vitest";
import {
  AWAITING_RELEASE,
  isReleasedForStudent,
  mayServeAnnotatedPage,
  responsesVisibleToStudent,
  studentFacingStatus,
} from "@/lib/release";

const released = { releasedAt: new Date("2026-11-04T10:00:00Z") };
const unreleased = { releasedAt: null };

const markedResponse = {
  id: "r1",
  status: "GRADED",
  studentAnswer: { text: "x = 4" },
  gradingResult: { outcome: "FINAL", awardedMarks: 4, maximumMarks: 4 },
  annotationResult: { aiAnnotation: { summary: "Well done" } },
  correctionResult: { comparison: { errors: [{ type: "ARITHMETIC_ERROR" }] } },
};

describe("isReleasedForStudent", () => {
  it("is true only when a teacher has set releasedAt", () => {
    expect(isReleasedForStudent(released)).toBe(true);
    expect(isReleasedForStudent(unreleased)).toBe(false);
  });

  it("treats a missing value like null, so an old row or a partial select can never read as released", () => {
    expect(isReleasedForStudent({} as { releasedAt: Date | null })).toBe(false);
    expect(isReleasedForStudent({ releasedAt: undefined } as unknown as { releasedAt: Date | null })).toBe(false);
  });
});

describe("responsesVisibleToStudent", () => {
  it("shows nothing about a mark before release — however finished the marking is", () => {
    const [visible] = responsesVisibleToStudent(unreleased, [markedResponse]);
    expect(visible.status).toBe("PENDING");
    expect(visible.gradingResult).toBeNull();
    expect(visible.annotationResult).toBeNull();
    expect(visible.correctionResult).toBeNull();
    expect(JSON.stringify(visible)).not.toMatch(/awardedMarks|Well done|ARITHMETIC_ERROR|FINAL/);
  });

  it("does not reveal whether an answer failed or was sent for review", () => {
    const statuses = ["GRADED", "FAILED", "NEEDS_REVIEW", "CORRECTING", "PENDING"];
    const shown = responsesVisibleToStudent(
      unreleased,
      statuses.map((status) => ({ ...markedResponse, status })),
    ).map((response) => response.status);
    expect(new Set(shown)).toEqual(new Set(["PENDING"]));
  });

  it("keeps the student's own answer", () => {
    const [visible] = responsesVisibleToStudent(unreleased, [markedResponse]);
    expect(visible.studentAnswer).toEqual({ text: "x = 4" });
  });

  it("does not add a correctionResult field to responses that never had one", () => {
    const { correctionResult: _unused, ...withoutCorrection } = markedResponse;
    void _unused;
    const [visible] = responsesVisibleToStudent(unreleased, [withoutCorrection]);
    expect("correctionResult" in visible).toBe(false);
  });

  it("returns everything unchanged once released", () => {
    expect(responsesVisibleToStudent(released, [markedResponse])).toEqual([markedResponse]);
  });

  it("does not modify the input", () => {
    const input = [{ ...markedResponse }];
    responsesVisibleToStudent(unreleased, input);
    expect(input[0].gradingResult).not.toBeNull();
  });
});

describe("studentFacingStatus", () => {
  it.each(["COMPLETED", "NEEDS_REVIEW", "FAILED"])("hides %s until released", (status) => {
    expect(studentFacingStatus({ status, ...unreleased })).toBe(AWAITING_RELEASE);
  });

  it.each(["DRAFT", "SUBMITTED", "PROCESSING"])("shows %s as it is, since it says nothing about marks", (status) => {
    expect(studentFacingStatus({ status, ...unreleased })).toBe(status);
  });

  it.each(["COMPLETED", "NEEDS_REVIEW", "FAILED", "SUBMITTED"])("shows the real status of %s once released", (status) => {
    expect(studentFacingStatus({ status, ...released })).toBe(status);
  });
});

describe("mayServeAnnotatedPage", () => {
  it("only serves a marked-up copy after release", () => {
    expect(mayServeAnnotatedPage(unreleased)).toBe(false);
    expect(mayServeAnnotatedPage(released)).toBe(true);
  });
});
