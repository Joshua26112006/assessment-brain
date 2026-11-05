// Evaluation harness (opt-in, calls real models). Run from the repo root:
//   npx tsx --tsconfig tsconfig.json scripts/eval/harness.ts [paperKey ...]
// Renders must exist first: scripts/eval/render.ps1 (see scripts/eval/README.md).
// No DB writes: DATABASE_URL is pointed at a dead address so AiCallLog writes fail silently.
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const SCRATCH = path.join(REPO, "scripts", "eval");

// The key comes from the environment, or from a .env in the folder this is run from.
const env: Record<string, string> = {};
const envFile = path.join(REPO, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(String.fromCharCode(10))) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";

type Q = { n: number; marks: number; text: string; answer: string[]; truth: string };
type Paper = { key: string; subject: string; grade: string; curriculum: string; title: string; questions: Q[] };

async function main() {
  const only = process.argv.slice(2);
  const papers: Paper[] = JSON.parse(fs.readFileSync(path.join(SCRATCH, "papers.json"), "utf8"));
  const { generateRubricWithAi } = await import("@/lib/rubricGeneration/ai");
  const { readStructuredAnswers } = await import("@/lib/structuredCorrection/structuredReading");
  const { correctStructuredQuestion } = await import("@/lib/structuredCorrection/pipeline");
  const { schemeOf } = await import("@/lib/scheme/criteria");
  fs.mkdirSync(path.join(SCRATCH, "results"), { recursive: true });

  for (const paper of papers.filter((p) => only.length === 0 || only.includes(p.key))) {
    const t0 = Date.now();
    console.log(`\n=== ${paper.key} (${paper.subject}) ===`);

    // 1. rubric generation (real call) — this is where "is this question checkable?" is decided
    const rubrics = await Promise.all(
      paper.questions.map(async (q) => {
        try {
          return await generateRubricWithAi({
            questionText: q.text, maximumMarks: q.marks, subject: paper.subject,
            grade: paper.grade, curriculum: paper.curriculum, assessmentTitle: paper.title,
          });
        } catch (e) { return { error: String(e) } as const; }
      }),
    );

    // 2. read the synthetic handwritten sheet (real vision calls, twice + reconcile)
    const buffer = fs.readFileSync(path.join(SCRATCH, "sheets", `${paper.key}.png`));
    const readings = await readStructuredAnswers(
      [{ pageId: "p1", pageNumber: 1, mimeType: "image/png", buffer }],
      paper.questions.map((q) => ({ questionNumber: q.n, questionText: q.text })),
    );

    // 3. correction per question
    const rows = await Promise.all(
      paper.questions.map(async (q, i) => {
        const rubric = rubrics[i];
        const reading = readings.get(q.n);
        const base = { q: q.n, marks: q.marks, text: q.text, truth: q.truth };
        if ("error" in rubric) return { ...base, rubricError: rubric.error };
        const exp = rubric.structuredExpectation;
        const rubricInfo = {
          solvable: exp?.solvable ?? null, unsolvableReason: exp?.unsolvableReason ?? null,
          problemType: exp?.problemType ?? null, correctAnswer: exp?.correctAnswer?.raw ?? null,
          expectedAnswer: rubric.expectedAnswer.slice(0, 160),
        };
        if (!reading) return { ...base, rubricInfo, reading: null };
        const c = await correctStructuredQuestion({
          questionId: `q${q.n}`, questionNumber: q.n, questionText: q.text, maximumMarks: q.marks,
          subject: paper.subject, expectedAnswer: rubric.expectedAnswer,
          markingCheckpoints: rubric.markingCheckpoints, partialCreditGuidance: rubric.partialCreditGuidance,
          scheme: schemeOf({ criteria: rubric.criteria, markingCheckpoints: rubric.markingCheckpoints }, q.marks),
          structuredExpectation: exp, reading,
        });
        return {
          ...base, rubricInfo,
          reading: {
            attempted: reading.attempted, transcription: reading.transcription, problemType: reading.problemType,
            studentAnswer: reading.studentAnswer?.raw ?? null, agreement: reading.agreementConfidence,
            structure: reading.structureConfidence,
          },
          awarded: c.score?.awardedMarks ?? null, feedback: c.score?.feedback?.slice(0, 220) ?? null,
          runs: c.score?.marking?.runTotals ?? null, unsure: c.score?.marking?.unsure ?? null,
          unsureReasons: c.score?.marking?.reasons ?? null,
          criteria: c.score?.marking?.criteria.map((x) => `${x.kind} ${x.awarded}/${x.maxMarks}`) ?? null,
          comparison: c.comparison.status, errors: c.comparison.errors.map((e) => `${e.type}${e.variable ? `(${e.variable})` : ""}`),
          verification: c.verification?.status ?? null,
          explanations: c.explanations.map((x) => x.explanation.slice(0, 200)),
        };
      }),
    );

    fs.writeFileSync(path.join(SCRATCH, "results", `${paper.key}.json`), JSON.stringify(rows, null, 2));
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const r of rows as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.log(
        `Q${r.q} [${r.marks}] solvable=${r.rubricInfo?.solvable} type=${r.rubricInfo?.problemType} ` +
          `attempted=${r.reading?.attempted} ans=${JSON.stringify(r.reading?.studentAnswer)} ` +
          `awarded=${r.awarded} cmp=${r.comparison} errs=${JSON.stringify(r.errors)} | truth: ${r.truth}`,
      );
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error("HARNESS FAILED", e); process.exit(1); });
