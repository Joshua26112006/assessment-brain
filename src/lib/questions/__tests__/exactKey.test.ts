import { describe, expect, it } from "vitest";
import { matchExactKey, normalizeAnswer } from "@/lib/questions/exactKey";

describe("normalizeAnswer", () => {
  it.each([
    ["B", "b"],
    ["(b)", "b"],
    ["b)", "b"],
    ["b.", "b"],
    ["Option B", "b"],
    ["Ans: (b)", "b"],
    ["answer b", "b"],
    ["  The Mitochondria. ", "mitochondria"],
    ["Café", "cafe"],
    ["Nehru's", "nehrus"],
    ["Jawaharlal   Nehru", "jawaharlal nehru"],
  ])("%j reads as %j", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });
});

describe("matchExactKey — an option letter (MCQ)", () => {
  it.each(["B", "b", "(b)", "b)", "Option B", "ans: b", "b."])("%j matches B", (written) => {
    expect(matchExactKey(written, ["B"])).toMatchObject({ verdict: "MATCH", definite: true });
  });

  it("a different letter is a definite miss: an option cannot be a valid variant", () => {
    expect(matchExactKey("C", ["B"])).toMatchObject({ verdict: "MISS", definite: true });
  });

  it("a blank answer is empty, not wrong", () => {
    expect(matchExactKey("", ["B"])).toMatchObject({ verdict: "EMPTY" });
    expect(matchExactKey("   ", ["B"])).toMatchObject({ verdict: "EMPTY" });
  });
});

describe("matchExactKey — a word, a name or a term", () => {
  const nehru = ["Jawaharlal Nehru", "Nehru", "Pandit Nehru"];

  it("matches the key or any listed variant, ignoring case, accents and punctuation", () => {
    expect(matchExactKey("nehru", nehru)).toMatchObject({ verdict: "MATCH", matched: "Nehru" });
    expect(matchExactKey("Jawaharlal Nehru.", nehru)).toMatchObject({ verdict: "MATCH", matched: "Jawaharlal Nehru" });
  });

  it("a spelling slip is CLOSE, never decided automatically", () => {
    expect(matchExactKey("Nehroo", nehru)).toMatchObject({ verdict: "CLOSE", definite: false });
    expect(matchExactKey("mitochondria", ["mitochondrion"])).toMatchObject({ verdict: "CLOSE" });
  });

  it("the key inside a longer answer, or a part of the key, is CLOSE", () => {
    expect(matchExactKey("it was Nehru", ["Nehru"])).toMatchObject({ verdict: "CLOSE" });
    expect(matchExactKey("Gandhi Nehru", ["Jawaharlal Nehru"])).toMatchObject({ verdict: "CLOSE" });
  });

  it("'Not Nehru' is not a match: containing the key is never enough on its own", () => {
    const result = matchExactKey("not Nehru", ["Nehru"]);
    expect(result.verdict).toBe("CLOSE");
  });

  it("a plainly different word is a MISS but not a definite one: it may be a valid variant nobody listed", () => {
    expect(matchExactKey("Sardar Patel", nehru)).toMatchObject({ verdict: "MISS", definite: false });
  });

  it("allows less slack for a short key", () => {
    expect(matchExactKey("cot", ["cat"])).toMatchObject({ verdict: "MISS" });
  });

  it("a number written differently is the same number", () => {
    expect(matchExactKey("4.0", ["4"])).toMatchObject({ verdict: "MATCH" });
    expect(matchExactKey("1/2", ["0.5"])).toMatchObject({ verdict: "MATCH" });
    expect(matchExactKey("5", ["4"])).toMatchObject({ verdict: "MISS" });
  });

  it("with no usable key nothing can be matched and nothing is definite", () => {
    expect(matchExactKey("anything", [])).toMatchObject({ verdict: "MISS", definite: false });
    expect(matchExactKey("anything", ["", "  "])).toMatchObject({ verdict: "MISS", definite: false });
  });
});
