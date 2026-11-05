import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { READ_MODEL } from "@/lib/ai/models";
import { callStructuredAiWithContent } from "@/lib/ai/callStructured";
import { questionPromptLine } from "@/lib/questions/labels";
import { parsePageResponse, stitchPass, type PageSegment, type StitchedReading } from "@/lib/structuredCorrection/pageSegments";
import { reconcileByKey, type ReconciledEntry } from "@/lib/structuredCorrection/reconcile";
import type { ReconciledReading } from "@/types/structuredCorrection";
import type { HandwrittenPageInput } from "@/lib/handwritten/types";

/**
 * Stage 1 of the structured correction flow: read each question's working off
 * the student's pages and decompose it into named quantities and a final
 * value, so a later deterministic stage can compare it against the rubric.
 *
 * Read PAGE BY PAGE, TWICE, and reconciled (see reconcile.ts, pageSegments.ts).
 *
 *   - Page by page: reading a whole paper in one reply capped the length of every answer and of the
 *     paper itself (one 8000-token reply had to hold everything). Each page is its own small call; the
 *     pieces of an answer that run across pages are stitched together by question.
 *   - Twice: a single vision-model pass over handwriting is not reliably repeatable — the same upload
 *     can disagree with itself about whether a question was even attempted — and every stage downstream
 *     depends on these values. The two passes are worded differently so their errors are less alike.
 *
 * Extraction only. This stage never solves the question, never consults the rubric, and never judges
 * correctness: it reports what the student wrote, copied exactly. Keeping it ignorant of the expected
 * answer is what stops it from quietly "reading" the answer the rubric wanted to see.
 */

export interface ReadingQuestion {
  questionNumber: number;
  /** What the paper calls it ("2(a)"); null for an ordinary question. */
  label?: string | null;
  questionText: string;
}

/** Pages read at the same time, so a long booklet does not flood the provider. */
const PAGE_CONCURRENCY = 4;
const MAX_TOKENS_PER_PAGE = 4000;

export type ReadingVariant = "top-down" | "marker-first";

export function buildPageSystemPrompt(variant: ReadingVariant): string {
  const approach =
    variant === "marker-first"
      ? "Work in two steps: first identify every question marker you can see on this page (\"3)\", \"Q3\", \"(3)\", \"3(b)\", \"(b)\" under question 3), then transcribe the writing that belongs to each marker. Report only the final JSON."
      : "Read the page from top to bottom, one answer at a time, and transcribe each as you reach it.";
  return [
    "You are reading ONE page of a student's handwritten answer sheet so that a separate program can check their working.",
    "You are NOT grading. Never judge whether anything is correct, never award marks, never correct anything, and never solve any question yourself.",
    approach,
    "Respond with ONLY a single JSON object, no text before or after it, matching exactly:",
    '{"segments": [{"questionNumber": number, "status": "active" | "struck" | "rough", "replaced": boolean, "transcription": string, "problemType": string, "steps": [string], "variables": {"<name>": "<value>"}, "studentAnswer": string, "containsDiagram": boolean, "language": string, "twoAttempts": boolean, "structureConfidence": "high" | "medium" | "low"}]}',
    "",
    "Rules, all mandatory:",
    "1. One segment for each piece of an answer that appears on THIS page. A question with nothing written on this page gets no segment. Never report a question that is not in the list below.",
    "2. An answer may start on an earlier page or carry on to a later one (the student may write \"contd.\" or just carry on with no number). If writing on this page plainly continues the previous question's answer, report it under that question's number.",
    "3. A question's answer begins at the student's own marker for it and ends where the next marker begins. Some questions are parts of a numbered question and are listed under the name a student writes, for example \"Question 2(a) (refer to it by the number 7)\"; always use the number the list gives, never the printed label.",
    "4. transcription: COPY EXACTLY what is written, character for character, including every mistake. NEVER correct arithmetic, spelling, grammar, units or logic; never complete an unfinished calculation; never tidy, reorder or paraphrase. If a word or value is illegible, write [illegible] in its place rather than guessing. A diagram or drawing is written as [diagram], with any words or numbers written on it copied beside it.",
    "5. status: \"active\" for work the student has left standing. \"struck\" for work the student crossed out, scribbled over or struck through; set replaced to true ONLY if they wrote another attempt at the same answer to replace it. \"rough\" for rough work: calculations in the margin, under a \"rough work\" heading, or scratch working that is clearly not part of the answer. Never drop crossed-out or rough work — report it with its status.",
    "6. twoAttempts: true when two DIFFERENT answers to the same question are both left standing (neither crossed out) on this page.",
    "7. containsDiagram: true when this piece of the answer includes a drawing, graph, geometric construction, map or chemical structure.",
    "8. language: the language the WORDS are written in, for example \"English\", \"Hindi\", \"Tamil\"; \"none\" when there are only numbers and symbols.",
    "9. problemType: exactly one of \"mean\", \"median\", \"mode\", \"range\", \"probability\", \"algebra\", \"coordinate_geometry\". Use \"unknown\" whenever you are not confident — never force a guess.",
    "10. steps: the distinct logical steps the student actually wrote, in their order. Do not invent steps they did not write.",
    "11. variables: every named quantity the student explicitly wrote a value for, as name to value (e.g. {\"l\": \"30\", \"f1\": \"15\"}). Copy each value EXACTLY as written; never compute, round or simplify. Use the student's own names. Use {} if none.",
    "12. studentAnswer: the student's own final concluding value on this page, verbatim. Empty string if they did not reach one here. Never supply a value the student did not write.",
    "13. structureConfidence: how confident you are that this decomposition faithfully reflects what is written — \"low\" if the handwriting was hard to read.",
  ].join("\n");
}

function buildQuestionList(questions: ReadingQuestion[]): string {
  return questions.map((q) => questionPromptLine(q)).join("\n");
}

async function readPage(
  page: HandwrittenPageInput,
  pageIndex: number,
  pageCount: number,
  questions: ReadingQuestion[],
  validQuestionNumbers: Set<number>,
  variant: ReadingVariant,
): Promise<PageSegment[]> {
  const userContent: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        `This is page ${pageIndex + 1} of ${pageCount} of the answer sheet.`,
        "",
        "The questions on this assessment are:",
        buildQuestionList(questions),
      ].join("\n"),
    },
    { type: "image_url", image_url: { url: `data:${page.mimeType};base64,${page.buffer.toString("base64")}` } },
  ];

  const raw = await callStructuredAiWithContent<unknown>({
    model: READ_MODEL,
    systemPrompt: buildPageSystemPrompt(variant),
    userContent,
    temperature: 0.1,
    maxAttempts: 2,
    maxTokens: MAX_TOKENS_PER_PAGE,
    stage: "STRUCTURED_READING",
  });
  return parsePageResponse(raw, validQuestionNumbers);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** One complete pass over every page, stitched by question. Fails if any page cannot be read: a pass with a missing page would look like a student who skipped it. */
async function readPass(
  pages: HandwrittenPageInput[],
  questions: ReadingQuestion[],
  validQuestionNumbers: Set<number>,
  variant: ReadingVariant,
): Promise<Map<number, StitchedReading>> {
  const perPage = await mapWithConcurrency(pages, PAGE_CONCURRENCY, (page, index) =>
    readPage(page, index, pages.length, questions, validQuestionNumbers, variant),
  );
  return stitchPass(perPage, validQuestionNumbers);
}

/** Prefers the read that found an answer at all, then the fuller transcription. */
function pickPreferred(a: StitchedReading, b: StitchedReading): StitchedReading {
  if (a.attempted !== b.attempted) return a.attempted ? a : b;
  return a.transcription.length >= b.transcription.length ? a : b;
}

/**
 * Reads every question twice in parallel and reconciles the two passes.
 *
 * Throws only if BOTH passes fail — a single failed pass still yields a
 * usable reading, marked low confidence because it could not be cross-checked.
 */
export async function readStructuredAnswers(
  pages: HandwrittenPageInput[],
  questions: ReadingQuestion[],
): Promise<Map<number, ReconciledReading>> {
  if (pages.length === 0 || questions.length === 0) return new Map();

  const validQuestionNumbers = new Set(questions.map((q) => q.questionNumber));

  // The two passes are worded differently on purpose: identical prompts to the same model make the same
  // mistakes together, which agreement between them cannot catch.
  const [passA, passB] = await Promise.allSettled([
    readPass(pages, questions, validQuestionNumbers, "top-down"),
    readPass(pages, questions, validQuestionNumbers, "marker-first"),
  ]);

  if (passA.status === "rejected" && passB.status === "rejected") {
    throw passA.reason instanceof Error ? passA.reason : new Error("Both structured reading passes failed.");
  }

  const readingsA = passA.status === "fulfilled" ? passA.value : new Map<number, StitchedReading>();
  const readingsB = passB.status === "fulfilled" ? passB.value : new Map<number, StitchedReading>();

  const reconciled = reconcileByKey(readingsA, readingsB, (value) => value.transcription, pickPreferred);

  const result = new Map<number, ReconciledReading>();
  for (const [questionNumber, entry] of reconciled) {
    // Whichever pass was NOT kept, so the comparison can require both passes
    // to have read a value the same way before treating it as the student's.
    const a = readingsA.get(questionNumber);
    const b = readingsB.get(questionNumber);
    const other = entry.value === a ? b : a;
    result.set(questionNumber, toReconciledReading(questionNumber, entry, other ?? null));
  }
  return result;
}

function toReconciledReading(
  questionNumber: number,
  entry: ReconciledEntry<StitchedReading>,
  other: StitchedReading | null,
): ReconciledReading {
  const { value } = entry;
  return {
    secondPass: other ? { variables: other.variables, studentAnswer: other.studentAnswer } : null,
    questionNumber,
    transcription: value.transcription,
    attempted: value.attempted,
    agreementConfidence: entry.confidence,
    problemType: value.problemType,
    steps: value.steps,
    variables: value.variables,
    studentAnswer: value.studentAnswer,
    structureConfidence: value.structureConfidence,
    segments: value.segments,
    // A diagram, a second language or two live attempts seen by EITHER pass is enough to ask a teacher.
    containsDiagram: value.containsDiagram || (other?.containsDiagram ?? false),
    languages: [...new Set([...value.languages, ...(other?.languages ?? [])])],
    conflictingAttempts: value.conflictingAttempts || (other?.conflictingAttempts ?? false),
  };
}
