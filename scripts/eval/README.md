# Evaluation harness

Opt-in checks of the correction pipeline against synthetic handwritten sheets. These scripts **call real AI models (costs money)** and **never write to the database**: they point `DATABASE_URL` at a dead address, so AI usage logging fails silently.

Run everything from the repository root on Windows.

1. Render the sheets (Windows, uses the "Ink Free" font):
   `powershell -NoProfile -File scripts/eval/render.ps1 -Spec scripts/eval/papers.json -OutDir scripts/eval/sheets`
2. Run the pipeline on all papers, or on named ones:
   `npx tsx --tsconfig tsconfig.json scripts/eval/harness.ts` or `... harness.ts physics chemistry`
   This prints one line per question (checkable?, read answer, mark, comparison status, findings, and the "truth" note from `papers.json`) and writes full JSON to `scripts/eval/results/<paper>.json`.
3. Measure run-to-run marking spread with one fixed rubric:
   `npx tsx --tsconfig tsconfig.json scripts/eval/stability.ts`

`papers.json` holds seven papers: a Mathematics control, Physics, Chemistry, Biology, English, History, and a prompt-injection paper. Each question has the student's answer lines and a `truth` note describing the expected mark. Add a paper by adding an entry, then re-render.

Limits: the handwriting is a clean font, so this does not measure real handwriting accuracy. See `06-correction-hardening-plan.md`, Phase 7, for the real-script golden set.
