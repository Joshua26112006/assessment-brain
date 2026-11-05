import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAiWithContent } from "@/lib/ai/callStructured";
import type { PixelBox } from "@/lib/figures/inkRegions";

/**
 * The reader model's opinion of where the hand-drawn diagrams are on one page of a student's sheet. It is a separate
 * request from reading the answers, so asking it can never change what is read. Its boxes are only one of two opinions:
 * a diagram is trusted only where the ink finder agrees (studentDiagrams.ts).
 */

const SYSTEM_PROMPT = [
  "You look at ONE page of a student's handwritten answer sheet and report where the hand-drawn pictures are.",
  "A picture is a drawing, sketch, graph, plotted axes, geometric figure, circuit, ray diagram, labelled diagram, map or table drawn with lines.",
  "It is NOT handwriting, a calculation, a sentence, ruled lines, the page border, a printed header or a margin note.",
  "Give one box for each separate picture, tight around it and including the labels written on it.",
  'Respond with ONLY JSON: {"diagrams": [{"box_2d": [ymin, xmin, ymax, xmax]}]}. Each number is a whole number from 0 to 1000, as a share of the page height (y) or width (x), counted from the top-left corner.',
  'If there is no picture on the page, respond {"diagrams": []}.',
  "Never describe, judge or mark the pictures. Report only where they are.",
].join("\n");

/** Boxes in a model's 0 to 1000 normalised form, turned into pixels. Null for a reply that cannot be understood. */
export function parseDiagramBoxes(raw: unknown, width: number, height: number): PixelBox[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { diagrams?: unknown }).diagrams;
  if (!Array.isArray(list)) return null;

  const boxes: PixelBox[] = [];
  for (const item of list) {
    const values = typeof item === "object" && item !== null ? (item as { box_2d?: unknown }).box_2d : undefined;
    if (!Array.isArray(values) || values.length !== 4 || !values.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const [ymin, xmin, ymax, xmax] = (values as number[]).map((v) => Math.min(1000, Math.max(0, v)));
    if (ymax - ymin < 20 || xmax - xmin < 20) continue; // smaller than 2% of the page either way: not a picture
    boxes.push({
      left: Math.round((xmin / 1000) * width),
      top: Math.round((ymin / 1000) * height),
      right: Math.round((xmax / 1000) * width),
      bottom: Math.round((ymax / 1000) * height),
    });
  }
  return boxes;
}

/** Null when the model could not be asked or its reply could not be understood; the caller then trusts no diagram. */
export async function locateDiagramsWithModel(jpeg: Buffer, width: number, height: number): Promise<PixelBox[] | null> {
  const userContent: ChatCompletionContentPart[] = [
    { type: "text", text: "Where are the hand-drawn pictures on this page?" },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callStructuredAiWithContent<unknown>({
        model: READ_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userContent,
        temperature: 0.1,
        maxAttempts: 2,
        maxTokens: 800,
        stage: "DIAGRAM_LOCATION",
      });
      const boxes = parseDiagramBoxes(raw, width, height);
      if (boxes) return boxes;
    } catch {
      // Try once more, then give up: no opinion is better than a wrong one.
    }
  }
  return null;
}
