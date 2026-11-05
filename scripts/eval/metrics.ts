// Launch-readiness metrics on a golden set (opt-in, calls real models, never writes to the database).
//
//   OPENROUTER_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/eval/metrics.ts <manifest.json> [--repeats 3] [--only physics]
//
// The manifest (see scripts/eval/golden/manifest.example.json) lists, per subject, the paper's questions and the
// scanned scripts with the marks two teachers gave each answer. The scripts themselves live OUTSIDE the repo; only
// the manifest is kept. For each subject this reports (plan, Phase 7):
//   - agreement with the teachers: exact, and within one mark
//   - false findings on correct answers (the target is 0)
//   - the flag rate: the share of answers sent to the teacher
//   - repeat stability: the share of answers whose awarded mark was identical in every repeat, or flagged
//   - cost and time per script
// No database writes: DATABASE_URL points at a dead address.
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env");
if (!process.env.OPENROUTER_API_KEY && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(String.fromCharCode(10))) {
    const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
    if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^"|"$/g, "");
  }
}
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";

interface ManifestQuestion { n: number; marks: number; text: string }
interface ManifestScript {
  id: string;
  /** Page images in order, relative to the manifest. */
  images: string[];
  /** Question number -> the marks each teacher gave (usually two). Omit a question that was not marked. */
  teacherMarks?: Record<string, number[]>;
}
interface ManifestPaper {
  key: string;
  subject: string;
  grade: string;
  curriculum: string;
  title: string;
  questions: ManifestQuestion[];
  scripts: ManifestScript[];
}

interface AnswerRun {
  awarded: number | null;
  flagged: boolean;
  findings: number;
  reasons: string[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (num: number, den: number) => (den === 0 ? "n/a" : `${Math.round((num / den) * 100)}% (${num}/${den})`);

async function main() {
  const args = process.argv.slice(2);
  let manifestPath: string | null = null;
  let repeats = 1;
  let only: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repeats") repeats = Math.max(1, Number(args[++i]) || 1);
    else if (args[i] === "--only") only = args[++i] ?? null;
    else if (!args[i].startsWith("--")) manifestPath = args[i];
  }
  if (!manifestPath) throw new Error("Usage: metrics.ts <manifest.json> [--repeats N] [--only paperKey]");
  const baseDir = path.dirname(path.resolve(manifestPath));
  const papers: ManifestPaper[] = JSON.parse(fs.readFileSync(manifestPath, "utf8")).papers;

  const { generateRubricWithAi } = await import("@/lib/rubricGeneration/ai");
  const { readStructuredAnswers } = await import("@/lib/structuredCorrection/structuredReading");
  const { correctStructuredQuestion } = await import("@/lib/structuredCorrection/pipeline");
  const { schemeOf } = await import("@/lib/scheme/criteria");
  const { onAiCallUsage } = await import("@/lib/ai/usageLog");

  let cost = 0;
  onAiCallUsage((usage) => { cost += usage.costUsd; });

  const report: Array<Record<string, unknown>> = [];

  for (const paper of papers.filter((p) => !only || p.key === only)) {
    console.log(`\n=== ${paper.subject} (${paper.key}): ${paper.scripts.length} script(s), ${repeats} repeat(s) ===`);
    // One rubric per question, shared by every script of the paper, as a teacher's approved scheme would be.
    const rubrics = await Promise.all(
      paper.questions.map((q) =>
        generateRubricWithAi({ questionText: q.text, maximumMarks: q.marks, subject: paper.subject, grade: paper.grade, curriculum: paper.curriculum, assessmentTitle: paper.title }).catch((e) => ({ error: String(e) }) as const),
      ),
    );

    // [script][question] -> one entry per repeat
    const runs = new Map<string, AnswerRun[]>();
    let scriptSeconds = 0;
    const costBefore = cost;

    for (const script of paper.scripts) {
      const pages = script.images.map((image, index) => ({
        pageNumber: index + 1,
        mimeType: image.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
        buffer: fs.readFileSync(path.join(baseDir, image)),
      }));
      for (let repeat = 0; repeat < repeats; repeat++) {
        const t0 = Date.now();
        const readings = await readStructuredAnswers(
          pages as never,
          paper.questions.map((q) => ({ questionNumber: q.n, questionText: q.text })),
        );
        await Promise.all(
          paper.questions.map(async (q, i) => {
            const rubric = rubrics[i];
            const key = `${script.id}#${q.n}`;
            const list = runs.get(key) ?? [];
            const reading = readings.get(q.n);
            if ("error" in rubric) {
              list.push({ awarded: null, flagged: true, findings: 0, reasons: ["no rubric could be drafted"] });
            } else if (!reading) {
              // Nothing was read for this question: in the real flow it has no answer row, is recorded as "not answered" and is not flagged.
              list.push({ awarded: 0, flagged: false, findings: 0, reasons: [] });
            } else {
              const c = await correctStructuredQuestion({
                questionId: `q${q.n}`, questionNumber: q.n, questionText: q.text, maximumMarks: q.marks, subject: paper.subject,
                expectedAnswer: rubric.expectedAnswer, markingCheckpoints: rubric.markingCheckpoints, partialCreditGuidance: rubric.partialCreditGuidance,
                scheme: schemeOf({ criteria: rubric.criteria, markingCheckpoints: rubric.markingCheckpoints }, q.marks),
                structuredExpectation: rubric.structuredExpectation, reading,
              }).catch(() => null);
              list.push({
                awarded: c?.score?.awardedMarks ?? null,
                flagged: !c?.score || c.score.marking?.unsure === true,
                findings: c?.explanations.length ?? 0,
                reasons: c?.score?.marking?.reasons ?? (c?.score ? [] : ["marking failed"]),
              });
            }
            runs.set(key, list);
          }),
        );
        scriptSeconds += (Date.now() - t0) / 1000;
      }
    }

    // ---- the numbers ----
    let answers = 0, flagged = 0, withTeachers = 0, exact = 0, withinOne = 0, correctAnswers = 0, falseFindings = 0, stable = 0;
    for (const script of paper.scripts) {
      for (const q of paper.questions) {
        const list = runs.get(`${script.id}#${q.n}`) ?? [];
        if (list.length === 0) continue;
        answers++;
        if (list.some((r) => r.flagged)) flagged++;
        const awardedAll = list.map((r) => r.awarded);
        if (awardedAll.every((a) => a !== null && a === awardedAll[0]) || list.some((r) => r.flagged)) stable++;

        const teacher = script.teacherMarks?.[String(q.n)];
        if (teacher && teacher.length > 0 && list[0].awarded !== null) {
          withTeachers++;
          const reference = mean(teacher);
          if (list[0].awarded === reference) exact++;
          if (Math.abs(list[0].awarded - reference) <= 1) withinOne++;
          if (teacher.every((t) => t === q.marks)) {
            correctAnswers++;
            if (list.some((r) => r.findings > 0)) falseFindings++;
          }
        }
      }
    }
    const reasonCounts: Record<string, number> = {};
    for (const list of runs.values()) for (const r of list) for (const reason of r.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    const perScriptSeconds = scriptSeconds / Math.max(1, paper.scripts.length * repeats);
    const perScriptCost = (cost - costBefore) / Math.max(1, paper.scripts.length * repeats);
    const row = {
      subject: paper.subject, scripts: paper.scripts.length, answers,
      agreementExact: pct(exact, withTeachers), agreementWithinOne: pct(withinOne, withTeachers),
      falseFindingsOnCorrectAnswers: pct(falseFindings, correctAnswers), flagRate: pct(flagged, answers),
      repeatStability: repeats > 1 ? pct(stable, answers) : "n/a (one repeat)",
      flagReasons: reasonCounts,
      secondsPerScript: Math.round(perScriptSeconds), costUsdPerScript: Number(perScriptCost.toFixed(4)),
    };
    report.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const outDir = path.join(process.cwd(), "scripts", "eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `metrics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nWritten to ${outFile}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
