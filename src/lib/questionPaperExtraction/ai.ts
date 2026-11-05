import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAiWithContent } from "@/lib/ai/callStructured";
import { flattenExtraction } from "./structure";
import type {
  ExtractedPaperDraft,
  ExtractedQuestionDraft,
  RawExtractedPaperDraft,
} from "@/types/questionPaper";

/** A page's raw bytes plus what the AI needs to interpret them correctly. */
export interface QuestionPaperPageInput {
  mimeType: string;
  buffer: Buffer;
}

const MAX_QUESTION_TEXT_LENGTH = 4000;
const MAX_TITLE_LENGTH = 300;
const MAX_INSTRUCTIONS_LENGTH = 4000;

const SYSTEM_PROMPT = [
  "You extract the structure of an exam question paper from the page image(s)/file the teacher uploaded, for a teacher review screen — you do not grade anything and you do not create any assessment on your own.",
  "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
  '{"title": string | null, "instructions": string | null, "questions": [ITEM], "totalMarks": number | null, "extractionWarnings": string[]}',
  'where ITEM is: {"number": number, "label": string, "text": string, "marks": number | null, "answerType": string, "uncertain": boolean, "parts": [ITEM], "alternatives": [ITEM], "optional": {"pick": number, "of": [ITEM]}} — and an ITEM uses AT MOST ONE of "parts", "alternatives" and "optional" (omit all three for an ordinary question).',
  "",
  "Rules, all mandatory:",
  "1. Extract ONLY what is actually visible on the uploaded pages. Never invent a question, a title, instructions, or a mark that isn't genuinely present.",
  "2. Preserve each question's original wording as closely as possible — do not paraphrase, summarize, or correct the teacher's phrasing.",
  "3. Preserve the paper's own question numbering exactly as printed (e.g. if the paper skips from 2 to 4, keep that gap rather than renumbering).",
  "4. Structure. Each top-level ITEM is one numbered question, with `number` as printed. Then:",
  "   - If it has sub-parts that ALL have to be answered (a, b, c; or (i), (ii)), put them in `parts`, each its own ITEM with its own `label` as printed (\"(a)\", \"(ii)\"), `text` and `marks`. The text of the numbered question itself (the shared setup) goes in the parent's `text`, not repeated in the parts. A parent with parts has no `marks` of its own.",
  "   - If the student answers ONE of several alternatives (\"(a) OR (b)\", \"Either ... or ...\"), put the alternatives in `alternatives`, each its own ITEM (with its own parts if it has them).",
  "   - If the paper says to attempt only some of a set (\"Attempt any 5 of the following 7\"), put every question of the set in `optional.of` and the number to attempt in `optional.pick`.",
  "   - An ordinary question has none of these: just `text` and `marks`.",
  "   Never invent structure the paper does not show.",
  "4a. answerType (a suggestion the teacher will check; use \"\" if unsure) for each question that has no parts: \"NUMERIC\" (a calculation with a numeric answer), \"EXACT_KEY\" (a multiple-choice option, a one-word answer, a name, date or fill-in-the-blank with one right answer), \"SHORT_TEXT\" (a one- or two-sentence answer), \"DESCRIPTIVE\" (an explanation worth several marks), \"ESSAY\" (a long answer or essay), \"DIAGRAM\" (the answer is a drawing, graph, construction, map or chemical structure).",
  "5. Set marks to the number printed for that question if and only if one is clearly printed (e.g. \"[5 marks]\", \"(10)\"). If no mark is printed or it is not legible, set marks to null — never guess or estimate a mark.",
  "6. Set instructions to the paper's own general instructions text if clearly present (e.g. \"Answer all questions. Show your working.\"); otherwise null. Never invent instructions.",
  "7. Set title to the paper's own heading/title if clearly present (e.g. \"Mid-Term Examination\"); otherwise null.",
  "8. Set totalMarks to the paper's own printed total if clearly stated; otherwise null. Do not calculate it yourself.",
  "9. Set uncertain to true for any question where the text, number, or presence of the question itself was genuinely hard to read (blurry, cropped, smudged, low resolution) — the teacher will double-check these. Do not mark every question uncertain by default; only genuine cases.",
  "10. If pages are supplied in multiple images, they are the pages of ONE single question paper in order — extract questions from all of them together into one combined list, not just the first page.",
  "11. If nothing readable is on the page(s) at all, return an empty questions array and explain why in extractionWarnings — never fabricate placeholder questions.",
  "12. extractionWarnings holds only genuine, specific caveats about what could not be read (e.g. \"Question 4 continues onto a page that appears cut off\"). Return an empty array if there are none — do not invent generic disclaimers.",
].join("\n");

/**
 * Runs AI-assisted extraction over one question paper's pages (a single PDF
 * page or one-to-many image pages, in order) and returns a validated draft.
 * Throws on network/parse failure (caller persists FAILED with the message)
 * or on a response that fails structural validation (Step 8) — this never
 * returns a value that hasn't been checked against real, sane constraints.
 */
export async function extractQuestionPaperWithAi(
  pages: QuestionPaperPageInput[],
): Promise<ExtractedPaperDraft> {
  if (pages.length === 0) {
    throw new Error("No pages were provided for extraction.");
  }

  const userContent: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: "Extract the structured question-paper content from the following page(s), in order.",
    },
    ...pages.map((page): ChatCompletionContentPart => {
      if (page.mimeType === "application/pdf") {
        return {
          type: "file",
          file: {
            filename: "question-paper.pdf",
            file_data: `data:application/pdf;base64,${page.buffer.toString("base64")}`,
          },
        };
      }
      return {
        type: "image_url",
        image_url: {
          url: `data:${page.mimeType};base64,${page.buffer.toString("base64")}`,
        },
      };
    }),
  ];

  const raw = await callStructuredAiWithContent<RawExtractedPaperDraft>({
    model: READ_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    temperature: 0.1,
    maxAttempts: 2,
    // A whole question paper with its parts and choices in one reply: roomy, but not the model's whole 65,536.
    maxTokens: 32_000,
    stage: "QUESTION_PAPER_EXTRACTION",
  });

  return validate(raw);
}

function toNullableTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1000) return null;
  return value;
}

/**
 * Structural validation (Step 8) — never trusts AI output blindly. A
 * malformed or absurd response throws here rather than silently producing
 * an empty/garbage draft, so the caller can persist a clear FAILED state
 * instead of an EXTRACTED one that looks successful but isn't trustworthy.
 */
function validate(raw: RawExtractedPaperDraft): ExtractedPaperDraft {
  if (!Array.isArray(raw.questions)) {
    throw new Error("AI extraction response did not contain a questions array.");
  }

  // Parts, "(a) OR (b)" alternatives and "any N of M" groups become a flat list of answerable questions
  // plus a tree saying how they combine (a plain paper is unchanged). See structure.ts.
  const flattened = flattenExtraction(raw.questions);
  const questions: ExtractedQuestionDraft[] = flattened.questions;

  const extractionWarnings = [
    ...(Array.isArray(raw.extractionWarnings)
      ? raw.extractionWarnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
      : []),
    ...flattened.warnings,
  ];

  if (questions.length === 0 && extractionWarnings.length === 0) {
    extractionWarnings.push(
      "No questions could be identified on the uploaded page(s). Please review the original file and add questions manually if needed.",
    );
  }

  return {
    title: toNullableTrimmedString(raw.title, MAX_TITLE_LENGTH),
    instructions: toNullableTrimmedString(raw.instructions, MAX_INSTRUCTIONS_LENGTH),
    questions,
    tree: flattened.tree,
    totalMarks: toNullableFiniteNumber(raw.totalMarks),
    extractionWarnings,
  };
}
