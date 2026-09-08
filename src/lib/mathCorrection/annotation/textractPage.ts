import { DetectDocumentTextCommand, TextractClient, type Block } from "@aws-sdk/client-textract";

/**
 * Locates things on a photographed answer sheet using AWS Textract's OCR:
 * where each question's answer begins, and where a specific piece of the
 * student's own writing sits on the page.
 *
 * Separate from the drawing code so the "where is it" problem and the "draw a
 * tick there" problem stay independently reviewable — this half is the one
 * that can be confidently wrong, and every function in it is written to give
 * up rather than guess. A mark drawn in the wrong place on a student's own
 * paper is worse than no mark at all.
 *
 * Coordinates throughout are 0-1 fractions of the page, exactly as Textract
 * reports them, so nothing here depends on the image's pixel dimensions.
 */

export interface BBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which half of a two-column notebook page an answer sits in, or the whole width. */
export type AnswerColumn = "left" | "right" | "full";

export interface QuestionMarker {
  bbox: BBox;
  column: AnswerColumn;
}

export interface PageAnalysis {
  markers: Map<number, QuestionMarker>;
  /** Every word on the page in real reading order, for locating quoted text. */
  readingOrderWords: Block[];
}

/**
 * A match on text alone is not enough: a garbled scrawl Textract was unsure
 * about can coincidentally read as "(5)". Below this confidence the candidate
 * is skipped and the search continues, so at worst a question goes unmarked
 * rather than being marked in the wrong place.
 */
const MIN_MARKER_CONFIDENCE = 70;

let client: TextractClient | null = null;

/**
 * Checks credentials up front rather than letting the AWS SDK resolve them
 * lazily and fail on first use with an error indistinguishable from any other
 * Textract fault — the same approach getOpenRouterClient already takes.
 * Never logs the credentials themselves, only that they are absent.
 */
function getTextractClient(): TextractClient {
  if (client) return client;

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not configured. Answer-sheet annotation cannot run without them.",
    );
  }

  client = new TextractClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function isQuestionMarker(wordText: string, questionNumber: number): boolean {
  const text = wordText.trim();
  const n = String(questionNumber);
  return (
    text === `${n})` ||
    text === `${n}.` ||
    text === `Q${n}` ||
    text === `q${n}` ||
    text === `(${n})` ||
    text === n
  );
}

/**
 * A two-column notebook page keeps every line inside its own half; a
 * full-width page routinely runs lines well past the middle. The marker's own
 * position cannot distinguish these — question numbers sit near the left
 * margin either way — so this looks at where the page's text as a whole ends.
 */
function isFullWidthPage(words: Block[]): boolean {
  const rightEdges = words
    .map((word) => (word.Geometry?.BoundingBox?.Left ?? 0) + (word.Geometry?.BoundingBox?.Width ?? 0))
    .filter((edge) => edge > 0);
  if (rightEdges.length === 0) return false;

  return rightEdges.filter((edge) => edge > 0.6).length / rightEdges.length > 0.15;
}

/** Words in true reading order — line by line down the page, left to right within each line. */
function buildReadingOrderWords(lines: Block[], wordById: Map<string, Block>): Block[] {
  const ordered = [...lines].sort(
    (a, b) => (a.Geometry?.BoundingBox?.Top ?? 0) - (b.Geometry?.BoundingBox?.Top ?? 0),
  );

  const words: Block[] = [];
  for (const line of ordered) {
    const childIds = line.Relationships?.find((rel) => rel.Type === "CHILD")?.Ids ?? [];
    for (const id of childIds) {
      const word = wordById.get(id);
      if (word) words.push(word);
    }
  }
  return words;
}

/**
 * Reads the page and locates each question's marker.
 *
 * A real marker is always the FIRST word of its own printed line — a number
 * sitting mid-sentence (say "(2)" inside a frequency table) never is. Markers
 * are also searched strictly in ascending order, each starting after the
 * previous one's line, so an earlier question's own content can never be
 * mistaken for a later question's marker.
 */
export async function analysePage(
  imageBytes: Buffer,
  questionNumbers: number[],
): Promise<PageAnalysis> {
  const response = await getTextractClient().send(
    new DetectDocumentTextCommand({ Document: { Bytes: imageBytes } }),
  );

  const blocks = response.Blocks ?? [];
  const words = blocks.filter((block) => block.BlockType === "WORD");
  const lines = blocks.filter((block) => block.BlockType === "LINE");

  const wordById = new Map<string, Block>();
  for (const word of words) {
    if (word.Id) wordById.set(word.Id, word);
  }

  const fullWidth = isFullWidthPage(words);

  const linesWithLeadingWord = lines
    .map((line) => {
      const firstChildId = line.Relationships?.find((rel) => rel.Type === "CHILD")?.Ids?.[0];
      const firstWord = firstChildId ? wordById.get(firstChildId) : undefined;
      return firstWord ? { line, firstWord } : null;
    })
    .filter((entry): entry is { line: Block; firstWord: Block } => entry !== null)
    .sort((a, b) => (a.line.Geometry?.BoundingBox?.Top ?? 0) - (b.line.Geometry?.BoundingBox?.Top ?? 0));

  const markers = new Map<number, QuestionMarker>();
  let searchFrom = 0;

  for (const questionNumber of [...questionNumbers].sort((a, b) => a - b)) {
    let matchIndex = -1;

    for (let i = searchFrom; i < linesWithLeadingWord.length; i++) {
      const word = linesWithLeadingWord[i].firstWord;
      if (!isQuestionMarker(word.Text ?? "", questionNumber)) continue;
      if ((word.Confidence ?? 0) < MIN_MARKER_CONFIDENCE) continue;
      matchIndex = i;
      break;
    }

    const box = matchIndex >= 0 ? linesWithLeadingWord[matchIndex].firstWord.Geometry?.BoundingBox : undefined;
    if (matchIndex === -1 || !box) continue;

    const markerMidX = (box.Left ?? 0) + (box.Width ?? 0) / 2;
    markers.set(questionNumber, {
      bbox: { left: box.Left ?? 0, top: box.Top ?? 0, width: box.Width ?? 0, height: box.Height ?? 0 },
      column: fullWidth ? "full" : markerMidX < 0.45 ? "left" : "right",
    });

    searchFrom = matchIndex + 1;
  }

  return { markers, readingOrderWords: buildReadingOrderWords(lines, wordById) };
}

/**
 * Symbols that handwriting OCR reads unreliably. Stripped before comparing
 * rather than compared: one dropped symbol should not sink an otherwise
 * correct match for a value that is plainly there.
 */
const UNRELIABLE_SYMBOLS = /[∴⇒⇔√°×÷→≈≠≤≥π]/g;

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[.,;:]+|[.,;:]+$/g, "")
    .replace(UNRELIABLE_SYMBOLS, "");
}

function enclosingBBox(words: Block[]): BBox | null {
  const boxes = words
    .map((word) => word.Geometry?.BoundingBox)
    .filter((box): box is NonNullable<typeof box> => !!box);
  if (boxes.length === 0) return null;

  const left = Math.min(...boxes.map((box) => box.Left ?? 0));
  const top = Math.min(...boxes.map((box) => box.Top ?? 0));
  const right = Math.max(...boxes.map((box) => (box.Left ?? 0) + (box.Width ?? 0)));
  const bottom = Math.max(...boxes.map((box) => (box.Top ?? 0) + (box.Height ?? 0)));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Finds where a quoted fragment of the student's own writing sits on the page.
 *
 * `words` must already be narrowed to one question's own answer region, so a
 * mistake can never be matched against text belonging to a different question.
 *
 * Searched from the END of the region backwards, preferring the LAST match: a
 * student's copied-out restatement of the question sits at the top of their
 * answer and often repeats the same numbers the question gave, so searching
 * forwards would reliably land on the restatement instead of the actual
 * working. Not foolproof — a value used correctly early and wrongly later can
 * still mismatch — but far better than the alternative.
 *
 * Returns null rather than a best guess when nothing matches confidently; the
 * caller then simply draws no circle.
 */
export function locateTextOnPage(words: Block[], wrongText: string): BBox | null {
  const target = wrongText.trim().split(/\s+/).map(normalizeToken).filter(Boolean);
  if (target.length === 0) return null;

  const normalized = words.map((word) => normalizeToken(word.Text ?? ""));

  // 1. The common case — an exact run of words.
  for (let i = normalized.length - target.length; i >= 0; i--) {
    let matches = true;
    for (let j = 0; j < target.length; j++) {
      if (normalized[i + j] !== target[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return enclosingBBox(words.slice(i, i + target.length));
  }

  // 2. Textract often splits one written token across words ("15/12" as
  //    "15", "/", "12"), so try joining short runs with no separator.
  const joinedTarget = target.join("");
  const MAX_SPAN = 5;
  for (let i = normalized.length - 1; i >= 0; i--) {
    let joined = "";
    for (let span = 1; span <= MAX_SPAN && i + span <= normalized.length; span++) {
      joined += normalized[i + span - 1];
      if (joined === joinedTarget) return enclosingBBox(words.slice(i, i + span));
    }
  }

  // 3. Allow a small number of mismatched tokens, so a single misread word
  //    doesn't sink a longer match. Only for phrases long enough that the
  //    tolerance doesn't make the match meaningless — allowing one mismatch
  //    in a two-word target would match almost anything.
  if (target.length >= 3) {
    const maxMismatches = target.length <= 5 ? 1 : 2;
    let best: { index: number; mismatches: number } | null = null;

    for (let i = 0; i <= normalized.length - target.length; i++) {
      let mismatches = 0;
      for (let j = 0; j < target.length; j++) {
        if (normalized[i + j] !== target[j]) mismatches++;
        if (mismatches > maxMismatches) break;
      }
      // <= so later equally-good matches win, for the same reason as above.
      if (mismatches <= maxMismatches && (!best || mismatches <= best.mismatches)) {
        best = { index: i, mismatches };
      }
    }

    if (best) return enclosingBBox(words.slice(best.index, best.index + target.length));
  }

  return null;
}
