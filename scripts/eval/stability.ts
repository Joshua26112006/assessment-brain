import fs from "node:fs";
const env: Record<string, string> = {};
for (const line of fs.readFileSync(".env", "utf8").split(String.fromCharCode(10))) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, ""); }
process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";
const items = [
  { subject: "Chemistry", q: "Balance the equation: H2 + O2 -> H2O", marks: 4, a: "2H2 + O2 -> 2H2O" },
  { subject: "English", q: "Explain the meaning of the idiom \"break the ice\".", marks: 3, a: "It means to start a conversation in a social situation so that people feel relaxed." },
  { subject: "History", q: "State two causes of the First World War.", marks: 4, a: "1. The alliance system divided Europe into two armed camps.\n2. The assassination of Archduke Franz Ferdinand in 1914." },
  { subject: "Physics", q: "A 2 kg object is lifted through a height of 5 m. Calculate the work done against gravity. (g = 10 m/s^2)", marks: 4, a: "W = mgh\n= 2 x 10 x 5\n= 120 J" },
  { subject: "History", q: "Explain two social effects of the Industrial Revolution.", marks: 6, a: "1. People moved from villages to cities looking for factory jobs, so cities grew fast.\n2. Many factories were built." },
];
(async () => {
  const { generateRubricWithAi } = await import("@/lib/rubricGeneration/ai");
  const { scoreQuestion } = await import("@/lib/structuredCorrection/scoring");
  for (const it of items) {
    const r = await generateRubricWithAi({ questionText: it.q, maximumMarks: it.marks, subject: it.subject, grade: "Grade 10", curriculum: "CBSE", assessmentTitle: "Unit Test" });
    const reading = { questionNumber: 1, transcription: it.a, attempted: true, agreementConfidence: "high" as const, problemType: "unknown" as const, steps: [], variables: {}, studentAnswer: null, structureConfidence: "high" as const };
    const marks = await Promise.all(Array.from({ length: 5 }, () => scoreQuestion({ questionText: it.q, maximumMarks: it.marks, subject: it.subject, expectedAnswer: r.expectedAnswer, markingCheckpoints: r.markingCheckpoints, partialCreditGuidance: r.partialCreditGuidance, reading }).then((s) => s.awardedMarks, (e) => `ERR ${e}`)));
    console.log(`STAB ${it.subject} [${it.marks}] ${it.q.slice(0, 45)}... -> ${JSON.stringify(marks)}`);
  }
  process.exit(0);
})();
