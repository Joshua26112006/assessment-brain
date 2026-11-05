import sharp from "sharp";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";

/**
 * How a question's figures and model diagram are put in front of a model: each picture, with a plain line saying what it
 * is, in a form the chat request accepts. Pictures are reduced to a size a model can read without paying for pixels it
 * cannot use, and at most a handful go in one request.
 */

export interface FigurePicture {
  role: "QUESTION_FIGURE" | "MODEL_DIAGRAM";
  png: Buffer;
}

/** The most pictures sent with one question. Printed figures come first, then model diagrams. */
export const MAX_FIGURES_PER_REQUEST = 6;
/** The longest side a picture is sent at. */
export const MODEL_PICTURE_SIDE = 1600;

export function captionFor(role: FigurePicture["role"], index: number): string {
  return role === "MODEL_DIAGRAM"
    ? `MODEL DIAGRAM ${index} (the teacher's correct drawing for this question; a student is asked to draw it):`
    : `FIGURE ${index} (printed in the question paper; the question refers to it):`;
}

export async function figureContentParts(figures: FigurePicture[]): Promise<ChatCompletionContentPart[]> {
  const ordered = [...figures.filter((f) => f.role === "QUESTION_FIGURE"), ...figures.filter((f) => f.role === "MODEL_DIAGRAM")].slice(0, MAX_FIGURES_PER_REQUEST);
  const parts: ChatCompletionContentPart[] = [];
  let printed = 0;
  let models = 0;
  for (const figure of ordered) {
    const index = figure.role === "MODEL_DIAGRAM" ? ++models : ++printed;
    const resized = await sharp(figure.png)
      .resize({ width: MODEL_PICTURE_SIDE, height: MODEL_PICTURE_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    parts.push({ type: "text", text: captionFor(figure.role, index) });
    parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${resized.toString("base64")}` } });
  }
  return parts;
}

/** What to tell the model about attached pictures, added to its instructions. Empty when there are none. */
export function figureInstructions(figures: FigurePicture[]): string {
  if (figures.length === 0) return "";
  const lines = [
    "",
    "PICTURES ARE ATTACHED to the question, below its text.",
  ];
  if (figures.some((f) => f.role === "QUESTION_FIGURE")) {
    lines.push("- A FIGURE is printed in the question paper. A reference to a figure, graph or table is NOT missing when one is attached: use what it shows (read values, labels and shapes from it) and never guess beyond it.");
  }
  if (figures.some((f) => f.role === "MODEL_DIAGRAM")) {
    lines.push("- A MODEL DIAGRAM is the teacher's correct drawing. Write the marking criteria as concrete, visible features a marker can check yes or no in a student's drawing (for example \"a ray parallel to the principal axis is drawn\", \"the ray passes through the focus after the lens\", \"arrows show the direction of each ray\", \"label F is shown on the axis\"), taken from the model diagram and the question. One feature per criterion.");
  }
  return lines.join("\n");
}
