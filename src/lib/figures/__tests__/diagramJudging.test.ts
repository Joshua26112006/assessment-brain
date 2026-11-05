import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
vi.mock("@/lib/ai/callStructured", () => ({ callStructuredAiWithContent: (...args: unknown[]) => ask(...args) }));

import {
  DIAGRAM_REPLY_SCHEMA,
  DIAGRAM_RUNS,
  decideDiagramMark,
  judgeDiagram,
  parseDiagramReply,
  rotated,
  type DiagramRun,
} from "@/lib/figures/diagramJudging";

const criteria = [
  { id: "c1", description: "A ray parallel to the axis is drawn", marks: 1 },
  { id: "c2", description: "The ray passes through the focus", marks: 1.5 },
  { id: "c3", description: "Arrows show the direction", marks: 0.5 },
];

const run = (answers: Record<string, "yes" | "no" | "unclear">, over: Partial<DiagramRun> = {}): DiagramRun => ({
  drawingPresent: true,
  legibility: "high",
  outcomes: criteria.map((c) => ({ id: c.id, met: answers[c.id], evidence: `saw ${c.id}` })),
  ...over,
});
const same = { c1: "yes", c2: "yes", c3: "no" } as const;
const clear = (over: Partial<Parameters<typeof decideDiagramMark>[0]> = {}) =>
  decideDiagramMark({ criteria, runs: [run(same), run(same), run(same)], cropsConfident: true, reference: "MODEL_DIAGRAM", ...over });

describe("decideDiagramMark: a very clear drawing", () => {
  it("is unflagged, with the marks of the criteria that are clearly there added up in code", () => {
    const decision = clear();
    expect(decision.veryClear).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(decision.awardedMarks).toBe(2.5);
    expect(decision.spread).toBe(0);
    expect(decision.perCriterion.map((c) => [c.id, c.awarded])).toEqual([["c1", 1], ["c2", 1.5], ["c3", 0]]);
  });

  it("a clear 'no' is as clear as a clear 'yes'", () => {
    const decision = clear({ runs: Array(3).fill(run({ c1: "no", c2: "no", c3: "no" })) });
    expect(decision.veryClear).toBe(true);
    expect(decision.awardedMarks).toBe(0);
  });

  it("works with every kind of reference except none", () => {
    for (const reference of ["PAPER_FIGURE", "MODEL_DIAGRAM", "BOTH"] as const) expect(clear({ reference }).veryClear).toBe(true);
  });
});

describe("decideDiagramMark: each rule on its own sends the answer to the teacher", () => {
  it("the crop was not certain", () => {
    const decision = clear({ cropsConfident: false });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("not certain");
    expect(decision.awardedMarks).toBe(2.5); // the draft is still shown
  });

  it("there is no reference at all", () => {
    const decision = clear({ reference: "NONE" });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("checklist alone");
  });

  it("the drawing is not high legibility in every run", () => {
    expect(clear({ runs: [run(same), run(same), run(same, { legibility: "medium" })] }).veryClear).toBe(false);
    expect(clear({ runs: [run(same), run(same), run(same, { legibility: "low" })] }).reasons.join(" ")).toContain("hard to make out");
  });

  it("any run could not tell a feature", () => {
    const decision = clear({ runs: [run(same), run(same), run({ ...same, c2: "unclear" })] });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("could not tell");
    expect(decision.reasons.join(" ")).toContain("passes through the focus");
  });

  it("the three runs do not all agree", () => {
    const decision = clear({ runs: [run(same), run(same), run({ ...same, c3: "yes" })] });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("did not all agree");
  });

  it("fewer than three runs completed", () => {
    const decision = clear({ runs: [run(same), run(same)] });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("2 of 3");
  });

  it("no run completed: a flag and no marks, never a silent zero", () => {
    const decision = clear({ runs: [] });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("no run of the checklist completed");
  });

  it("a run saw no drawing at all", () => {
    expect(clear({ runs: [run(same), run(same), run(same, { drawingPresent: false })] }).veryClear).toBe(false);
  });

  it("a feature has no description of what was seen", () => {
    const blank = run(same);
    blank.outcomes[0].evidence = "";
    const decision = clear({ runs: [blank, blank, blank] });
    expect(decision.veryClear).toBe(false);
    expect(decision.reasons.join(" ")).toContain("no description");
  });
});

describe("decideDiagramMark: the draft mark", () => {
  it("counts an unclear feature as not earned, and flags it", () => {
    const decision = clear({ runs: Array(3).fill(run({ c1: "yes", c2: "unclear", c3: "yes" })) });
    expect(decision.awardedMarks).toBe(1.5);
    expect(decision.veryClear).toBe(false);
  });

  it("takes the middle total, and the lower of the middle two when a run is missing", () => {
    const high = run({ c1: "yes", c2: "yes", c3: "yes" });
    const low = run({ c1: "yes", c2: "no", c3: "no" });
    expect(clear({ runs: [high, low, high] }).awardedMarks).toBe(3);
    expect(clear({ runs: [high, low] }).awardedMarks).toBe(1);
  });

  it("reports how far the runs spread", () => {
    expect(clear({ runs: [run({ c1: "yes", c2: "yes", c3: "yes" }), run(same), run({ c1: "no", c2: "no", c3: "no" })] }).spread).toBe(3);
  });
});

describe("parseDiagramReply", () => {
  const ids = ["c1", "c2", "c3"];
  const reply = (criteriaList: unknown[]) => ({ drawingPresent: true, legibility: "high", criteria: criteriaList });
  const entry = (id: string, met = "yes") => ({ id, met, evidence: " a feature " });

  it("accepts a complete reply and trims the evidence", () => {
    const parsed = parseDiagramReply(reply([entry("c1"), entry("c2", "no"), entry("c3", "unclear")]), ids);
    expect(parsed?.outcomes).toEqual([
      { id: "c1", met: "yes", evidence: "a feature" },
      { id: "c2", met: "no", evidence: "a feature" },
      { id: "c3", met: "unclear", evidence: "a feature" },
    ]);
  });

  it("refuses a reply that leaves a criterion out: a gap must never become a no", () => {
    expect(parseDiagramReply(reply([entry("c1"), entry("c2")]), ids)).toBeNull();
  });

  it("refuses a bad answer, a bad legibility, and a bad shape", () => {
    expect(parseDiagramReply(reply([entry("c1"), entry("c2", "maybe"), entry("c3")]), ids)).toBeNull();
    expect(parseDiagramReply({ drawingPresent: true, legibility: "fine", criteria: [] }, [])).toBeNull();
    expect(parseDiagramReply(null, ids)).toBeNull();
  });

  it("ignores an unknown or repeated id", () => {
    const parsed = parseDiagramReply(reply([entry("zzz"), entry("c1"), entry("c1", "no"), entry("c2"), entry("c3")]), ids);
    expect(parsed?.outcomes.map((o) => [o.id, o.met])).toEqual([["c1", "yes"], ["c2", "yes"], ["c3", "yes"]]);
  });
});

describe("rotated", () => {
  it("shifts the list, so each run sees the criteria in a different order", () => {
    expect(rotated([1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(rotated([1, 2, 3], 1)).toEqual([2, 3, 1]);
    expect(rotated([1, 2, 3], 4)).toEqual([2, 3, 1]);
    expect(rotated([], 2)).toEqual([]);
  });
});

describe("the strict schema", () => {
  it("lists every property as required and allows nothing else", () => {
    const schema = DIAGRAM_REPLY_SCHEMA.schema;
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.criteria.items.additionalProperties).toBe(false);
  });
});

describe("judgeDiagram", () => {
  let png: Buffer;
  beforeEach(async () => {
    ask.mockReset();
    ask.mockImplementation(async () => ({}));
    png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ffffff" } }).png().toBuffer();
  });
  const input = () => ({ questionText: "Draw it", subject: "Physics", maximumMarks: 3, criteria, studentCrops: [png], references: [{ role: "MODEL_DIAGRAM" as const, png }] });
  const goodReply = (askedIds: string[]) => ({ drawingPresent: true, legibility: "high", criteria: askedIds.map((id) => ({ id, met: "yes", evidence: "seen" })) });

  it("makes three runs, each with the criteria in a different order", async () => {
    const orders: string[][] = [];
    ask.mockImplementation(async (options: { userContent: Array<{ type: string; text?: string }> }) => {
      const text = options.userContent[0].text ?? "";
      const ids = [...text.matchAll(/id "(c\d)"/g)].map((m) => m[1]);
      orders.push(ids);
      return goodReply(ids);
    });
    const runs = await judgeDiagram(input());
    expect(runs).toHaveLength(DIAGRAM_RUNS);
    expect(new Set(orders.map((o) => o.join(","))).size).toBe(3);
  });

  it("sends the student's drawing and the references as pictures", async () => {
    let parts: Array<{ type: string }> = [];
    ask.mockImplementation(async (options: { userContent: Array<{ type: string; text?: string }> }) => {
      parts = options.userContent;
      return goodReply(["c1", "c2", "c3"]);
    });
    await judgeDiagram(input());
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
  });

  it("asks a run again once after a bad reply, then leaves it out", async () => {
    let calls = 0;
    ask.mockImplementation(async (options: { userContent: Array<{ type: string; text?: string }> }) => {
      calls++;
      const ids = [...(options.userContent[0].text ?? "").matchAll(/id "(c\d)"/g)].map((m) => m[1]);
      // The first run's first attempt is malformed; every later attempt, and the retry, is fine.
      return calls === 1 ? { nonsense: true } : goodReply(ids);
    });
    expect(await judgeDiagram(input())).toHaveLength(3);

    ask.mockReset();
    ask.mockImplementation(async () => ({ nonsense: true }));
    expect(await judgeDiagram(input())).toHaveLength(0);
  });

  it("survives a model that cannot be reached: no runs, never a throw", async () => {
    ask.mockImplementation(async () => {
      throw new Error("network");
    });
    expect(await judgeDiagram(input())).toEqual([]);
  });
});
