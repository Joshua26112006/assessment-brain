# Phase 5 reading check (opt-in, calls real models)

A synthetic three-page sheet with the cases the plan lists: a crossed-out answer that is replaced, margin
rough work, a diagram, a Hindi answer, and an essay that runs across three pages.

    powershell -File scripts/eval/phase5/render.ps1 -OutDir <folder>
    OPENROUTER_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/eval/phase5/read.ts <folder>

Expected (Nov 5, 2026, real run): Q1 marks only `x = 5` (the struck `x = 4` and the margin rough work are
kept but not marked); Q2 `containsDiagram`; Q3 languages `["Hindi"]`; Q4 stitched from pages 1, 2 and 3.
No database writes: DATABASE_URL points at a dead address.
