// Run-to-run stability (opt-in, calls real models). From the repo root:
//   OPENROUTER_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/eval/stability.ts
// For each fixed answer it generates ONE rubric, then marks the same answer 5 times the OLD way
// (one holistic mark) and 5 times the NEW way (per criterion, three runs, median), so the spread of the
// two can be compared on identical inputs. No DB writes: DATABASE_URL points at a dead address.
import fs from "node:fs";

const envFile = ".env";
if (!process.env.OPENROUTER_API_KEY && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(String.fromCharCode(10))) {
    const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
    if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^"|"$/g, "");
  }
}
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/none";

const items = [
  { subject: "Chemistry", q: "Balance the equation: H2 + O2 -> H2O", marks: 4, a: "2H2 + O2 -> 2H2O", final: "2H2 + O2 -> 2H2O" },
  { subject: "English", q: "Explain the meaning of the idiom \"break the ice\".", marks: 3, a: "It means to start a conversation in a social situation so that people feel relaxed.", final: "" },
  { subject: "History", q: "State two causes of the First World War.", marks: 4, a: "1. The alliance system divided Europe into two armed camps.\n2. The assassination of Archduke Franz Ferdinand in 1914.", final: "" },
  { subject: "Physics", q: "A 2 kg object is lifted through a height of 5 m. Calculate the work done against gravity. (g = 10 m/s^2)", marks: 4, a: "W = mgh\n= 2 x 10 x 5\n= 120 J", final: "120 J" },
  { subject: "History", q: "Explain two social effects of the Industrial Revolution.", marks: 6, a: "1. People moved from villages to cities looking for factory jobs, so cities grew fast.\n2. Many factories were built.", final: "" },
];

(async () => {
  const { generateRubricWithAi } = await import("@/lib/rubricGeneration/ai");
  const { scoreQuestion } = await import("@/lib/structuredCorrection/scoring");
  const { scoreByCriteria } = await import("@/lib/structuredCorrection/criterionScoring");
  const { schemeOf } = await import("@/lib/scheme/criteria");
  const { parseNumericExpression } = await import("@/lib/structuredCorrection/numericExpression");

  const spread = (xs: Array<number | string>) => {
    const nums = xs.filter((x): x is number => typeof x === "number");
    return nums.length ? Math.max(...nums) - Math.min(...nums) : NaN;
  };

  for (const it of items) {
    const r = await generateRubricWithAi({ questionText: it.q, maximumMarks: it.marks, subject: it.subject, grade: "Grade 10", curriculum: "CBSE", assessmentTitle: "Unit Test" });
    const answerValue = it.final ? { raw: it.final, parsed: parseNumericExpression(it.final) } : null;
    const reading = {
      questionNumber: 1, transcription: it.a, attempted: true, agreementConfidence: "high" as const, problemType: "unknown" as const,
      steps: it.a.split("\n"), variables: {}, studentAnswer: answerValue, structureConfidence: "high" as const,
      secondPass: { variables: {}, studentAnswer: answerValue },
    };
    const scheme = schemeOf({ criteria: r.criteria, markingCheckpoints: r.markingCheckpoints }, it.marks);

    const oldMarks = await Promise.all(Array.from({ length: 5 }, () => scoreQuestion({ questionText: it.q, maximumMarks: it.marks, subject: it.subject, expectedAnswer: r.expectedAnswer, markingCheckpoints: r.markingCheckpoints, partialCreditGuidance: r.partialCreditGuidance, reading }).then((s) => s.awardedMarks, (e) => `ERR ${e}`)));
    const newMarks = await Promise.all(Array.from({ length: 5 }, () => scoreByCriteria({ questionText: it.q, maximumMarks: it.marks, subject: it.subject, expectedAnswer: r.expectedAnswer, partialCreditGuidance: r.partialCreditGuidance, scheme, structuredExpectation: r.structuredExpectation, comparison: null, reading }).then((s) => ({ marks: s.awardedMarks as number | string, unsure: s.marking?.unsure ?? false }), (e) => ({ marks: `ERR ${e}` as number | string, unsure: true }))));

    console.log(`STAB ${it.subject} [${it.marks}] ${it.q.slice(0, 45)}...`);
    console.log(`   old (one holistic mark x5):        ${JSON.stringify(oldMarks)}  spread ${spread(oldMarks)}`);
    console.log(`   new (criteria, median of 3, x5):   ${JSON.stringify(newMarks.map((n) => n.marks))}  spread ${spread(newMarks.map((n) => n.marks))}  flagged for teacher: ${newMarks.filter((n) => n.unsure).length}/5`);
  }
  process.exit(0);
})();
