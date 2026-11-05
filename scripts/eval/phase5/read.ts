process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";
import fs from "node:fs";
(async () => {
  const dir = process.argv[2];
  const pages = [1, 2, 3].map((n) => ({ pageNumber: n, mimeType: "image/png", buffer: fs.readFileSync(`${dir}/page${n}.png`) }));
  const questions = [
    { questionNumber: 1, label: null, questionText: "Solve 2x + 3 = 13 for x." },
    { questionNumber: 2, label: null, questionText: "Draw a triangle ABC and label its vertices." },
    { questionNumber: 3, label: null, questionText: "Write one sentence in reply." },
    { questionNumber: 4, label: null, questionText: "Explain the causes of the First World War." },
  ];
  const { readStructuredAnswers } = await import("@/lib/structuredCorrection/structuredReading");
  const t0 = Date.now();
  const readings = await readStructuredAnswers(pages as never, questions);
  console.log(`READ done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const q of questions) {
    const r = readings.get(q.questionNumber);
    if (!r) { console.log(`READ Q${q.questionNumber}: (no reading)`); continue; }
    console.log(`READ Q${q.questionNumber}: attempted=${r.attempted} agreement=${r.agreementConfidence} structure=${r.structureConfidence} diagram=${r.containsDiagram} languages=${JSON.stringify(r.languages)} conflict=${r.conflictingAttempts} answer=${JSON.stringify(r.studentAnswer?.raw ?? null)}`);
    console.log(`READ    marked text: ${JSON.stringify(r.transcription.slice(0, 260))}`);
    for (const s of r.segments ?? []) console.log(`READ    seg p${s.page} ${s.status} marked=${s.marked}: ${JSON.stringify(s.text.slice(0, 90))}`);
  }
  process.exit(0);
})();
