// Measures the reading model at different temperatures (opt-in, calls real models, never writes to the database).
//
//   OPENROUTER_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/eval/readtemp.ts <sheetsDir> [--temps 0.1,1] [--repeats 3]
//
// <sheetsDir> holds one PNG per paper in papers.json, named <paper key>.png (render.ps1 makes them). The truth is the
// handwriting the sheet was drawn from (papers.json `answer` lines), so reading accuracy is measured, not guessed:
//   - accuracy: how close the transcription is to what was written (1 = identical, by edit distance)
//   - both passes agree: the share of answers where the two differently-worded passes agreed (high confidence)
//   - repeat stability: the share of answers read word for word the same in every repeat
//   - failures: reads that threw
import fs from "node:fs";
import path from "node:path";

const envFile = path.join(process.cwd(), ".env");
if (!process.env.OPENROUTER_API_KEY && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
    if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^"|"$/g, "");
  }
}
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";

interface PaperQuestion { n: number; text: string; answer: string[] }
interface Paper { key: string; questions: PaperQuestion[] }

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9=+\-*/().,%^ ]/g, "").trim();

function similarity(a: string, b: string): number {
  const x = normalise(a), y = normalise(b);
  if (x.length === 0 && y.length === 0) return 1;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] === y[j - 1] ? 0 : 1));
      previous = temp;
    }
  }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}

async function main() {
  const args = process.argv.slice(2);
  const sheetsDir = args.find((a) => !a.startsWith("--"));
  if (!sheetsDir) throw new Error("Usage: readtemp.ts <sheetsDir> [--temps 0.1,1] [--repeats 3]");
  const temps = (args[args.indexOf("--temps") + 1] && args.includes("--temps") ? args[args.indexOf("--temps") + 1] : "0.1,1").split(",").map(Number);
  const repeats = args.includes("--repeats") ? Math.max(1, Number(args[args.indexOf("--repeats") + 1]) || 3) : 3;
  const papers: Paper[] = (JSON.parse(fs.readFileSync(path.join(__dirname, "papers.json"), "utf8")).papers ?? JSON.parse(fs.readFileSync(path.join(__dirname, "papers.json"), "utf8")));

  const { readStructuredAnswers } = await import("@/lib/structuredCorrection/structuredReading");
  const { onAiCallUsage } = await import("@/lib/ai/usageLog");
  let cost = 0;
  onAiCallUsage((usage) => { cost += usage.costUsd; });

  const rows: Array<Record<string, unknown>> = [];
  for (const temperature of temps) {
    process.env.READING_TEMPERATURE = String(temperature);
    let answers = 0, similaritySum = 0, high = 0, stable = 0, failures = 0, runs = 0;
    const costBefore = cost;
    for (const paper of papers) {
      const file = path.join(sheetsDir, `${paper.key}.png`);
      if (!fs.existsSync(file)) continue;
      const pages = [{ pageNumber: 1, mimeType: "image/png", buffer: fs.readFileSync(file) }];
      const questions = paper.questions.map((q) => ({ questionNumber: q.n, label: null, questionText: q.text }));
      const transcriptions = new Map<number, string[]>();
      for (let repeat = 0; repeat < repeats; repeat++) {
        runs++;
        try {
          const readings = await readStructuredAnswers(pages as never, questions);
          for (const q of paper.questions) {
            const reading = readings.get(q.n);
            const text = reading?.transcription ?? "";
            transcriptions.set(q.n, [...(transcriptions.get(q.n) ?? []), text]);
            answers++;
            similaritySum += similarity(text, q.answer.join(" "));
            if (reading && reading.agreementConfidence === "high") high++;
          }
        } catch {
          failures++;
        }
      }
      for (const list of transcriptions.values()) if (list.length === repeats && list.every((t) => normalise(t) === normalise(list[0]))) stable++;
    }
    const questionCount = papers.reduce((n, p) => n + p.questions.length, 0);
    const row = {
      temperature,
      answersRead: answers,
      accuracy: answers ? Number((similaritySum / answers).toFixed(3)) : null,
      bothPassesAgree: answers ? `${Math.round((high / answers) * 100)}% (${high}/${answers})` : "n/a",
      repeatStable: `${stable} of ${questionCount} answers`,
      failedRuns: `${failures} of ${runs}`,
      costUsd: Number((cost - costBefore).toFixed(4)),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const outDir = path.join(process.cwd(), "scripts", "eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `readtemp-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
