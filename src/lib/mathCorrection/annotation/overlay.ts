import type { AnswerColumn, BBox } from "@/lib/mathCorrection/annotation/textractPage";

/**
 * Draws the teacher-style marks that get composited onto a student's own page:
 * a tick, a partial-credit double stroke or a cross beside each question, the
 * marks awarded circled at the edge, the total at the top of the first page,
 * and a ring around each specific mistake.
 *
 * Numbers are drawn as line segments rather than SVG <text>. Some SVG
 * rasterizers silently render nothing for <text> when the expected font is
 * missing — and silently is the problem: the marks would simply be absent from
 * a student's returned paper with no error anywhere. Line primitives always
 * render, so every number here is built from strokes.
 */

const RED = "#cc0000";

interface SevenSegment {
  a: [number, number, number, number];
  b: [number, number, number, number];
  c: [number, number, number, number];
  d: [number, number, number, number];
  e: [number, number, number, number];
  f: [number, number, number, number];
  g: [number, number, number, number];
}

/** Segment endpoints in a 1-wide, 2-tall unit box. */
const SEGMENTS: SevenSegment = {
  a: [0, 0, 1, 0],
  b: [1, 0, 1, 1],
  c: [1, 1, 1, 2],
  d: [0, 2, 1, 2],
  e: [0, 1, 0, 2],
  f: [0, 0, 0, 1],
  g: [0, 1, 1, 1],
};

const DIGIT_SEGMENTS: Record<string, (keyof SevenSegment)[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

function digitMetrics(height: number) {
  return {
    width: height * 0.55,
    gap: height * 0.22,
    strokeWidth: Math.max(3, height * 0.12),
  };
}

/** Marks can be fractional (1.5), so the decimal point is measured too. */
function drawableCharacters(text: string): string[] {
  return text.split("").filter((char) => DIGIT_SEGMENTS[char] || char === ".");
}

export function digitsWidth(text: string, height: number): number {
  const { width, gap } = digitMetrics(height);
  const chars = drawableCharacters(text);
  if (chars.length === 0) return 0;

  const total = chars.reduce((sum, char) => sum + (char === "." ? width * 0.3 : width), 0);
  return total + gap * (chars.length - 1);
}

/** Draws `text` (digits and decimal points only) centred at (cx, cy). */
export function drawDigits(text: string, cx: number, cy: number, height: number, color: string): string {
  const { width, gap, strokeWidth } = digitMetrics(height);
  const chars = drawableCharacters(text);
  if (chars.length === 0) return "";

  let x = cx - digitsWidth(text, height) / 2;
  const y = cy - height / 2;
  const strokes: string[] = [];

  for (const char of chars) {
    if (char === ".") {
      strokes.push(
        `<circle cx="${(x + width * 0.15).toFixed(1)}" cy="${(y + height).toFixed(1)}" r="${(strokeWidth * 0.7).toFixed(1)}" fill="${color}"/>`,
      );
      x += width * 0.3 + gap;
      continue;
    }

    if (char === "0") {
      // A round zero reads more naturally than the boxy seven-segment shape.
      strokes.push(
        `<ellipse cx="${(x + width / 2).toFixed(1)}" cy="${(y + height / 2).toFixed(1)}" rx="${(width / 2).toFixed(1)}" ry="${(height / 2).toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" fill="none"/>`,
      );
    } else {
      for (const segment of DIGIT_SEGMENTS[char]) {
        const [x1, y1, x2, y2] = SEGMENTS[segment];
        strokes.push(
          `<line x1="${(x + x1 * width).toFixed(1)}" y1="${(y + y1 * (height / 2)).toFixed(1)}" x2="${(x + x2 * width).toFixed(1)}" y2="${(y + y2 * (height / 2)).toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
        );
      }
    }
    x += width + gap;
  }

  return strokes.join("\n");
}

/** Marks are shown as written by a teacher: 3 not 3.0, 1.5 kept as 1.5. */
function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export interface QuestionMark {
  /** Vertical centre of the question's marker, as a 0-1 fraction of page height. */
  markerTop: number;
  column: AnswerColumn;
  awardedMarks: number;
  maximumMarks: number;
}

export interface OverlayInput {
  width: number;
  height: number;
  questions: QuestionMark[];
  mistakes: BBox[];
  /** Rendered only on the first page, so a submission carries one visible total. */
  total: { awarded: number; maximum: number } | null;
}

export function buildOverlaySvg(input: OverlayInput): string {
  const { width, height } = input;
  const elements: string[] = [];

  if (input.total) {
    elements.push(drawTotal(width, input.total.awarded, input.total.maximum));
  }

  const scoreX: Record<AnswerColumn, number> = {
    left: Math.round(width * 0.47) - 40,
    right: Math.round(width * 0.95) - 40,
    full: Math.round(width * 0.95) - 40,
  };
  const markStartX: Record<AnswerColumn, number> = {
    left: Math.round(width * 0.03),
    right: Math.round(width * 0.52),
    full: Math.round(width * 0.03),
  };
  const markEndX: Record<AnswerColumn, number> = {
    left: Math.round(width * 0.19),
    right: Math.round(width * 0.68),
    full: Math.round(width * 0.19),
  };

  for (const question of input.questions) {
    const y = Math.round(question.markerTop * height);
    const startX = markStartX[question.column];
    const endX = markEndX[question.column];

    if (question.awardedMarks >= question.maximumMarks) {
      elements.push(drawTick(startX, endX, y));
    } else if (question.awardedMarks > 0) {
      elements.push(drawPartial(startX, endX, y));
    } else {
      elements.push(drawCross(startX, endX, y));
    }

    elements.push(drawCircledMarks(scoreX[question.column], y, question.awardedMarks));
  }

  for (const mistake of input.mistakes) {
    elements.push(drawMistakeRing(mistake, width, height));
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${elements.join("\n")}\n</svg>`;
}

/** Asymmetric tick — a short first leg and a long sweep, the way it is written by hand. */
function drawTick(startX: number, endX: number, y: number): string {
  const vertexX = Math.round(startX + (endX - startX) * 0.18);
  return `<polyline points="${startX},${y - 6} ${vertexX},${y + 28} ${endX},${y - 85}" stroke="${RED}" stroke-width="7.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Two parallel strokes for partial credit — distinct from both the tick and the cross. */
function drawPartial(startX: number, endX: number, y: number): string {
  const midX = Math.round((startX + endX) / 2);
  const gap = 16;
  const slant = Math.round((endX - startX) * 0.45);
  const topY = y - 55;
  const bottomY = y + 32;
  return [
    `<line x1="${midX - gap - slant / 2}" y1="${bottomY}" x2="${midX - gap + slant / 2}" y2="${topY}" stroke="${RED}" stroke-width="7" stroke-linecap="round"/>`,
    `<line x1="${midX + gap - slant / 2}" y1="${bottomY}" x2="${midX + gap + slant / 2}" y2="${topY}" stroke="${RED}" stroke-width="7" stroke-linecap="round"/>`,
  ].join("\n");
}

function drawCross(startX: number, endX: number, y: number): string {
  const cx = Math.round(startX + (endX - startX) * 0.5);
  return [
    `<line x1="${cx - 28}" y1="${y - 28}" x2="${cx + 28}" y2="${y + 28}" stroke="${RED}" stroke-width="7.5" stroke-linecap="round"/>`,
    `<line x1="${cx + 28}" y1="${y - 28}" x2="${cx - 28}" y2="${y + 28}" stroke="${RED}" stroke-width="7.5" stroke-linecap="round"/>`,
  ].join("\n");
}

function drawCircledMarks(cx: number, cy: number, awarded: number): string {
  const label = formatMarks(awarded);
  const digitHeight = 34;
  const rx = Math.max(34, digitsWidth(label, digitHeight) / 2 + 18);
  return [
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="30" stroke="${RED}" stroke-width="3.5" fill="none"/>`,
    drawDigits(label, cx, cy, digitHeight, RED),
  ].join("\n");
}

/**
 * The total, as a circled fraction at a fixed spot on page one. Always the
 * same position regardless of where answers fall — overlapping some writing is
 * an accepted trade for a total that is always findable in the same place.
 */
function drawTotal(width: number, awarded: number, maximum: number): string {
  const awardedLabel = formatMarks(awarded);
  const maximumLabel = formatMarks(maximum);
  const digitHeight = 40;
  const widest = Math.max(digitsWidth(awardedLabel, digitHeight), digitsWidth(maximumLabel, digitHeight));

  const cx = Math.round(width / 2);
  const cy = 85;
  const rx = Math.max(55, widest / 2 + 30);
  const ry = 78;

  return [
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${ry}" stroke="${RED}" stroke-width="4" fill="none"/>`,
    `<line x1="${cx - rx + 10}" y1="${cy}" x2="${cx + rx - 10}" y2="${cy}" stroke="${RED}" stroke-width="4"/>`,
    drawDigits(awardedLabel, cx, cy - 32, digitHeight, RED),
    drawDigits(maximumLabel, cx, cy + 32, digitHeight, RED),
  ].join("\n");
}

function drawMistakeRing(box: BBox, width: number, height: number): string {
  const cx = Math.round((box.left + box.width / 2) * width);
  const cy = Math.round((box.top + box.height / 2) * height);
  const rx = Math.max(20, (box.width * width) / 2 + 8);
  const ry = Math.max(16, (box.height * height) / 2 + 8);
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" stroke="${RED}" stroke-width="3" fill="none"/>`;
}
