# Correction Hardening Plan

Nov 4, 2026 · Build plan for the AI correction pipeline · Branch `feature/question-generation` from commit `41c5063`

This plan turns the AI correction pipeline into a product a school can trust. It is written for the engineer (or coding agent) who will build it. Read sections 1 to 4 before writing any code. They hold the decisions already made, so you do not need to ask about them again.

---

## 1. How to use this plan

1. **Read first:** `AGENTS.md` (this Next.js version has breaking changes, so read the guide in `node_modules/next/dist/docs/` before touching app code). Then `05-workflow.md` sections "Purpose and the one rule", Stage 3 and Stage 4. That file is the product specification. This plan implements the parts of it that the correction pipeline needs.
2. **Build the phases in order.** Each phase depends on the ones before it. Phase 1 comes first because it makes every remaining marking error safe: once a teacher confirms every mark before a student sees it, an AI mistake becomes extra teacher work instead of a wrong mark on a child's paper.
3. **One phase = one or more small commits**, each passing `npx tsc --noEmit`, `npx eslint` and the test suite from Phase 0. Never mix a refactor with a behaviour change in one commit.
4. **Database:** `DATABASE_URL` points at a shared, live Neon database. Create migrations with `prisma migrate dev --create-only`, review the SQL, and **ask the product owner before applying any migration**. Never run `prisma migrate reset`, `db push --force-reset`, or anything that drops data.
5. **AI calls cost money.** Unit tests must never call a model. Model calls belong only in the opt-in evaluation script (Phase 0).
6. **When this plan does not cover a decision, stop and ask.** Do not invent marking policy. Section 3 lists everything already decided.

---

## 2. What the product does and where the code is

A teacher uploads a question paper. AI drafts a marking scheme (rubric) per question. Students' handwritten answer sheets are photographed. The pipeline reads the handwriting, marks each answer against the rubric, finds mistakes, and draws ticks, marks and circles on a copy of the page.

| Area | Where |
| --- | --- |
| Handwritten flow entry point | `src/lib/handwritten/evaluation.ts` (`evaluateHandwrittenSubmission`) |
| Answer-sheet reading and mapping answers to questions | `src/lib/handwritten/answerReading.ts`, `processing.ts`, `validation.ts` |
| Structured correction (reading, comparison, verification, explanation, scoring, annotation) | `src/lib/structuredCorrection/*` |
| Its types | `src/types/structuredCorrection.ts` |
| Older checkpoint pipeline (used only when no question is "checkable") | `src/lib/assessment/pipeline.ts` |
| Rubric generation | `src/lib/rubricGeneration/*` (`ai.ts`, `structuredExpectation.ts`, `index.ts`) |
| Question-paper extraction | `src/lib/questionPaperExtraction/*` |
| Teacher review queue and overrides | `src/app/teacher/review-queue/*`, `src/lib/assessment/reviewResolution.ts`, `pipelineReviewItems.ts` |
| Student results | `src/app/student/results/[submissionId]/page.tsx`, `src/lib/submission-score.ts` |
| AI client, models, retries, usage log | `src/lib/ai/*` (`models.ts`: READ = gemini-3.6-flash, JUDGE = gpt-5.6-luna, VERIFY = gpt-5.6-terra) |
| Schema | `prisma/schema.prisma` |

**Facts about today's code that this plan changes** (all verified):

- Students see a mark the moment it is `GRADED` with outcome `FINAL`. There is no release gate (`src/app/student/results/[submissionId]/page.tsx:200`, `:273-295`). `AssessmentStatus.RESULTS_AVAILABLE` and `CLOSED` exist but are never set.
- AI rubrics are written straight to `ACTIVE`, with no teacher approval (`src/lib/rubricGeneration/index.ts:117-147`). `RubricVersionStatus.DRAFT` and `AssessmentStatus.RUBRIC_REVIEW` exist but are unused.
- The manual rubric editor (`src/app/teacher/assessments/[id]/actions.ts:326-398`, `saveRubricVersion`) saves only `solutionApproaches` and `markingCheckpoints`. It drops `expectedAnswer`, `partialCreditGuidance` and `structuredExpectation`, which silently changes how the paper is routed.
- A teacher can change a mark only on a flagged review item, and history keeps one previous value inside JSON. There is no audit table.
- `Question` is a flat `questionNumber` (Int) + `questionText` + `maximumMarks`. There are no sub-parts, choices, optional questions or question types. Extraction merges sub-parts into one question's text.
- If **any** question is checkable, the whole paper goes down the structured route (`evaluation.ts:141`). Essay questions on that paper then get one marking call and no independent evaluation.
- If both structured reading passes fail, the submission is left in `PROCESSING` with no review item (`structuredCorrection/submission.ts`, the read-failure `catch`).
- The whole paper is read in one model call: up to 8000 output tokens for the structured read, and 4000 characters per answer.
- There are no tests, and no test framework.

---

## 3. Decisions already made (do not re-ask)

Made by the product owner on Nov 4, 2026, or taken from `05-workflow.md`.

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Release | **A teacher approves every mark before release.** Nothing reaches a student until the teacher presses "Confirm marks" for the class. Bulk-accept is allowed only for answers that are not flagged; flagged answers need an individual click. |
| D2 | Marking consistency | **Mark every answer 3 times and award the median.** Flag for the teacher when the 3 runs differ by more than 1 mark or by more than 25% of the question's marks. Score each rubric criterion as its own yes/no check, never one holistic number. |
| D3 | Diagrams, graphs, constructions, maps, chemical structures | **Teacher only.** No AI mark. Send the answer to the teacher's queue with a crop of the region. |
| D4 | Question formats to support | **Sub-parts** 1(a)/1(b); **internal choice** "(a) OR (b)"; **optional** "any 5 of 7"; **MCQ / one-word / fill-in** with an exact key match. |
| D5 | Findings on the student's copy | **Only what the teacher kept.** AI findings are suggestions in the teacher's view, which the teacher can keep, edit or delete. The marked copy shows only what was kept. |
| D6 | Correct final answer with no working | **Award only the final-answer step's marks.** Method steps get 0 unless the scheme says otherwise for that question, and the answer is flagged for the teacher. |
| D7 | Languages | **English only** at launch. Detect any other language and flag "cannot mark", with no AI mark. |
| D8 | Marking scheme ownership (spec, Stage 0 and Stage 3) | The AI drafts, the teacher reviews, edits and approves. **Nothing is marked until the scheme is approved.** It is locked with the test. |
| D9 | How marks are built (spec, Stage 3) | A question's mark is always the **sum of its steps / value points**. Leniency lives in the scheme as explicit choices, never in a hidden setting. |
| D10 | Follow-through rule (spec, Stage 3) | Stated per question as one of *allowed*, *not allowed* or *method marks only*, with a school-wide default. Never decided by the AI. |
| D11 | Units (spec, Stage 3) | A unit mark is an explicit step in the scheme where the question needs one. The engine converts equivalent units (2000 mg = 2 g). |
| D12 | Mark granularity | Half marks (0.5) are the smallest unit, as on CBSE schemes. |
| D13 | Scheme changes after marking (spec, Stage 3) | Re-apply to every answer already drafted. For answers the teacher already confirmed, show the change to the teacher, never silently overwrite. |
| D14 | Internal choice and over-attempts (CBSE 2026 rule) | When a student attempts both choices, mark both, **count the higher**, and keep the other visible as an "over attempt" (marked with \*, excluded from the total). Optional "any N": count the best N the same way. |
| D15 | Precision over recall | When unsure, make **no** claim about the student and flag the teacher. Telling a student that correct work is wrong is the worst outcome. A missed finding is acceptable. |

---

## 4. Principles every change must keep

1. **The AI drafts, the teacher decides** (`05-workflow.md` line 7).
2. **Never a silent zero.** If a mark cannot be produced, or two stages disagree about whether something was answered, the answer goes to a teacher. Never record a 0 that nobody will look at.
3. **Deterministic wherever possible.** Numbers, units, totals, choice selection and exact-match answers are decided by code, not by a model.
4. **Every mark is explainable.** Per criterion: what was checked, what evidence (a line of the transcription) supports it, and how many marks.
5. **Everything is audited.** Every AI draft, every run's raw marks, every teacher change (who, when, old, new, reason) is stored append-only.
6. **The original page image is never modified.**
7. **Existing verified behaviour stays.** The fixes in commit `41c5063` (section 5) have tests in Phase 0. Do not weaken them.

---

## 5. Already fixed (commit `41c5063`), for reference

These are done and tested. Phase 0 turns their checks into permanent unit tests.

- **Number reading** (`structuredCorrection/numericExpression.ts`):
  - compound units (`m/s²`, `Ω`, `°C`), whitelist only
  - `x = 4`, `Ans: 4`, `∴ x = 4`, `a = 20/5 = 4`; equations, inequalities and self-contradicting lines stay unreadable
  - typeset minus; `1,000` and `1,00,000`
  - `3 × 10^8`, `10⁸`, `1.6e-19`, powers
- **Comparison** (`comparisonEngine.ts`):
  - non-numeric rubric answers are skipped (`skipped_not_numeric`)
  - values used without a name are not "missing"
  - "missing" is claimed only when the final answer is known to be wrong
  - correct rounding is accepted
  - the tolerance scales for small values
  - case-only name matches never claim a wrong value
  - a power-of-ten difference with a unit written makes no claim
  - value claims need both reading passes to agree
  - low-confidence and single-pass readings make no claims (`skipped_low_confidence`)
- **Marking** (`scoring.ts`):
  - a text mark (`"3"`) is accepted
  - an unusable mark is retried, then sent to a teacher (never a silent 0)
  - student text addressed to the marker is ignored
- **Persistence** (`submission.ts`):
  - writing found by mapping but not by the reader → teacher review
  - the page total is out of the whole paper's marks
- The flow is subject-neutral (commit `c866f66`).

---

## 6. Target design in one page

**Question paper as a tree** (D4, D14):

```
Assessment
 └─ QuestionNode (kind: QUESTION | PART | CHOICE_GROUP | OPTIONAL_GROUP)
     ├─ label           "3", "3(b)", "3(b)(ii)"     ← what students write and what's drawn
     ├─ answerType      NUMERIC | SHORT_TEXT | DESCRIPTIVE | ESSAY | EXACT_KEY | DIAGRAM   (leaves only)
     ├─ maximumMarks    leaves: their marks; groups: computed
     ├─ pick            CHOICE_GROUP: 1 of its children; OPTIONAL_GROUP: N of its children
     └─ children
```

**Marking scheme per leaf** (D8 to D12): a list of **criteria**, each a yes/no check worth a set number of marks (multiples of 0.5).

| Criterion kind | Example | Decided by |
| --- | --- | --- |
| `STEP` | "Writes v = u + at" (1) | marking model, 3 runs |
| `VALUE` | "Substitutes u = 0, a = 2" (1) | code (comparison engine) when numeric, otherwise the model |
| `FINAL_ANSWER` | "49 m/s" (1) | code when numeric (with unit conversion), otherwise exact key or model |
| `UNIT` | "Unit m/s stated" (½) | code |
| `VALUE_POINT` | "Mentions chlorophyll" (1) | marking model, 3 runs |
| `LEVEL` | essay band "4–5: all points with examples" | marking model, 3 runs, **always reviewed** (spec line 217) |
| `EXACT_KEY` | MCQ "B", one-word "Nehru" (+ accepted variants) | code |

Each scheme also carries `followThrough` (D10), `acceptedAlternatives`, `noWorkingRule` (default from D6), and `status` DRAFT → APPROVED (D8).

**Per-answer record** (spec, "How answers are stored and shown"): the leaf, the source page regions, the verbatim transcription, the language, the segment status (active / struck / rough), each criterion result per run, the median mark, a confidence flag (`SURE | UNSURE | CANNOT_READ | TEACHER_ONLY`) with the reasons, AI findings as suggestions, and the teacher's final mark and comment.

**Release state per assessment and class:** `DRAFTING → IN_REVIEW → CONFIRMED (by whom, when) → RELEASED`. Students see nothing until `RELEASED`.

**Routing is per leaf, by `answerType`**, never per paper:

| answerType | Path |
| --- | --- |
| NUMERIC | structured reading → comparison engine for VALUE / FINAL_ANSWER / UNIT criteria → model for STEP criteria |
| EXACT_KEY | code match against the key and its variants |
| SHORT_TEXT, DESCRIPTIVE | model scores each VALUE_POINT / STEP criterion, 3 runs |
| ESSAY | model scores LEVEL + value points, 3 runs, always `UNSURE` |
| DIAGRAM | no AI mark, `TEACHER_ONLY` with the crop |

---

## 7. Phases

Each phase lists **what to build**, **files**, **done when**, and the catalog issues it closes (issue numbers refer to section 9).

### Phase 0 — Test foundation (do this first, small)

**Build**

1. Add Vitest (`npm i -D vitest`), a `test` script in `package.json`, and a `vitest.config.ts` that resolves the `@/` alias from `tsconfig.json`.
2. `src/lib/structuredCorrection/__tests__/numericExpression.test.ts`: every case in Appendix A (A.1 must equal the old behaviour; A.2 the new behaviour).
3. `src/lib/structuredCorrection/__tests__/comparisonEngine.test.ts`: every scenario in Appendix B, asserting the **new** result column.
4. `src/lib/structuredCorrection/__tests__/scoring.test.ts`: mock `callStructuredAi` and cover the following:
   - a mark returned as a string (`"3"`)
   - a non-numeric mark retried, then an error thrown
   - a mark above the maximum
   - a not-attempted answer, which returns 0 without calling the model
5. Move the evaluation harness into the repo as `scripts/eval/` (it is already there; see Appendix C). It is opt-in, calls real models, and never touches the database. Document how to run it in `scripts/eval/README.md`.

**Done when** `npm test` passes with no network access, and `scripts/eval` runs end to end on the six synthetic papers.

### Phase 1 — Release gate, teacher confirmation, audit (the safety net)

> **Status (Nov 4, 2026): mostly built, on branch `feature/question-generation` (commits `69a6c2a` to `b12e713`).**
>
> **Done:** the per-submission release gate (`src/lib/release.ts`, applied to every student page and the page-image route); `Submission.confirmedAt/releasedAt` and the append-only `MarkEvent` table (migration `20261104180000_add_mark_release_and_audit`, **applied to the live database on Nov 4, 2026**); the domain layer (`src/lib/assessment/markRelease.ts`, `markReview.ts`, `markedCopy.ts`); the teacher review screen at `/teacher/assessments/[id]/submissions/[submissionId]`; keep/remove for AI findings; the marked copy drawn at release from the teacher's marks; AI_DRAFT audit events; the stuck-submission fix; the old review-queue now locked and audited.
>
> **Deviation from step 2 below:** the gate is a per-submission `releasedAt`, not a new `DRAFT` grading outcome. It needed no change to any outcome consumer, and a late submission can never be shown before a teacher confirms it.
>
> **Not done yet:** (a) the older checkpoint pipeline (`assessment/pipeline.ts`) writes no `AI_DRAFT` event (it is gated and locked like everything else); (b) "fix the transcription and re-run that answer" on the review screen (step 4); (c) a reason is optional when changing a mark, because the data model has no test-versus-exam type; (d) the review screen has only been compile-checked (`next build`), not clicked through in a browser.
>
> **Verified:** all 12 migrations applied from zero in a scratch schema, and a 31-step teacher and student flow ran through the real domain code on real Postgres (confirm, release, reopen, locks, ownership, audit rows, trigger refusing edits). **Not yet done:** opening the review screen in a browser.


**Build**

1. **Schema** (one migration; ask before applying):
   - `MarkReleaseState` per (assessment, class/section), or on `Assessment` if there is one class per assessment (check `prisma/schema.prisma`, `Class`), with states `DRAFTING | IN_REVIEW | CONFIRMED | RELEASED` plus `confirmedById`, `confirmedAt`, `releasedById`, `releasedAt`.
   - `MarkEvent`, an append-only audit table: `questionResponseId`, `kind` (`AI_DRAFT | AI_RUN | TEACHER_ACCEPT | TEACHER_CHANGE | TEACHER_COMMENT | SCHEME_REAPPLIED | RECHECK`), `marks`, `previousMarks`, `actorId` (null for AI), `reason`, `payload` JSON (model, samples, fingerprint), `createdAt`.
   - Never update or delete `MarkEvent` rows.
2. **Every AI-produced mark becomes a draft.** In `structuredCorrection/submission.ts` (`buildGradingResult`) and in the older pipeline's grading stage, write outcome `DRAFT` (add it to the `GradingResult` outcome type in `src/types/pipeline.ts`) instead of `FINAL`. `FINAL` is set only by teacher confirmation.
3. **Student visibility.**
   - `src/app/student/results/*`, `src/lib/submission-score.ts` and every student-facing query must show marks, feedback and annotated pages **only when the release state is `RELEASED`**. Before that, show "Being marked".
   - Add a single helper (e.g. `src/lib/release.ts` → `isReleasedForStudent(submission)`) and use it everywhere. Grep for `gradingResult`, `annotatedStorageKey` and `parseGradingResult` under `src/app/student` to find them all.
4. **Teacher review screen** (extends the review queue; spec Stage 4):
   - List every answer of the class, ordered `CANNOT_READ` / `TEACHER_ONLY` first, then `UNSURE` (lowest confidence first), then `SURE`.
   - Per answer: page crop, transcription, per-criterion draft results, median mark, the 3 run marks, flags with plain-language reasons, and AI findings (suggestions).
   - Actions: accept; change the mark (reason optional for tests, required for exams); edit the transcription, which re-runs the draft for that answer only; keep, edit or delete each finding (D5); comment.
   - Bulk "Accept all sure answers" for unflagged rows only.
   - Each action writes a `MarkEvent`.
5. **Confirm and release.**
   - "Confirm marks for this class" is enabled only when every answer is accepted or changed, and no answer is pending, failed or unread. It writes `CONFIRMED` with name and time.
   - "Release to students" sets `RELEASED`, sets outcome `FINAL` on every response, and generates the marked copy from the teacher-kept findings and final marks.
   - Move annotation generation from correction time to release time (spec line 244). The drawing code in `structuredCorrection/annotation/*` stays; only the trigger and its inputs change.
6. **Fix the stuck-submission bug.** When both structured reading passes fail, flag every pending response `CANNOT_READ` with an `AMBIGUOUS_EXTRACTION` review item and recalculate status. Never leave the submission in `PROCESSING`.
7. **Unanswered questions** (no response row): at confirmation, list them as "not attempted, 0" for the teacher to accept. Today they show `PENDING` forever (`submission-score.ts`).

**Done when**

- A test proves that no student-facing loader returns marks before `RELEASED`.
- A full submission can be reviewed, confirmed and released by a teacher in the UI.
- Every mark change produces a `MarkEvent`.
- A both-reads-failed submission ends in the teacher's queue, not `PROCESSING`.

**Closes:** 35 (made safe), 36 (made safe), 42, 43, 48, 52, 53.

### Phase 2 — Marking scheme: teacher approval and explicit policy

> **Status (Nov 5, 2026): built** on `feature/correction-hardening` (worktree `E:\ab-hardening`). Approval gate on both marking routes, criteria scheme, real unit conversion, editor data-loss fix, scheme change re-apply. Migration `20261105100000` applied to live. Deviations and open decisions: `07-hardening-log.md`. Existing live rubrics are not backfilled and show "waiting for approval".

**Build**

1. **Approval gate** (D8):
   - Generated rubric versions are saved as `DRAFT`, and the rubric is `READY_FOR_REVIEW`.
   - Marking (both pipelines) refuses to run against a non-`APPROVED` version.
   - Publishing the assessment requires every leaf's scheme to be approved (`readiness.ts`, `publishAssessment` in `actions.ts`).
   - Add "Approve scheme" per question and "Approve all", with a `MarkEvent`-style record of who approved and when.
2. **Scheme shape:** extend `RubricVersion`, or add a `RubricCriterion` table, to hold the criteria list from section 6. Each criterion has kind, description, marks (a multiple of 0.5) and the evidence hint. Add the scheme-level fields `followThrough` (school default plus a per-question override), `noWorkingRule` (default D6) and `acceptedAlternatives`.
   - Migrate existing `markingCheckpoints` into `STEP` criteria.
3. **Rubric generation prompt** (`rubricGeneration/ai.ts`) outputs criteria by kind:
   - an explicit `UNIT` criterion wherever the answer has a unit
   - criterion marks in multiples of 0.5 that sum exactly to the question's maximum (validate in code, keeping `normalizeCheckpointMarks` behaviour)
   - an exact key plus accepted variants for EXACT_KEY leaves
   - `structuredExpectation.correctAnswer` **keeps its unit**: change the rule "Do not add ... units" and store `{ value, unit }`
4. **Unit-aware comparison** (D11):
   - Add a small unit module (`structuredCorrection/units.ts`) that converts SI prefixes and common units (mass, length, volume, time, charge, energy, pressure, temperature offsets) to base units.
   - In `comparisonEngine.ts`, compare converted values. A `UNIT` criterion passes only when the student's unit is equivalent.
   - Remove the interim `possibleUnitConversion` suppression, since with real conversion a genuine "forgot mL → L" mistake is caught again. Keep a test for 2000 mg = 2 g (correct) and 2000 g ≠ 2 g (wrong).
5. **Fix the manual editor** (`saveRubricVersion`) so it saves every scheme field. Today it drops `expectedAnswer`, `partialCreditGuidance` and `structuredExpectation`.
6. **Scheme change after marking** (D13): when an approved scheme is edited, re-run drafting for every unconfirmed answer to that question. For confirmed answers, add a "scheme changed: draft is now X (was Y)" item to the teacher's queue. Never overwrite a confirmed mark.

**Done when**

- No answer can be drafted against an unapproved scheme.
- A teacher can approve or edit criteria in the UI.
- Unit tests cover the unit conversions and the follow-through and no-working rules.

**Closes:** 15, 16, 21, 38, 40, 51 (teacher approval), plus the editor data-loss bug.

### Phase 3 — Question formats: parts, choices, optional, exact-key

> **Status (Nov 5, 2026): built.** Labels, `questionTree`, totals in code (including D14 over-attempt with a star), exact-key marking, marker forms. Migration `20261105110000` applied to live. Deviation: parts are normal `Question` rows with their own number plus a label, and the tree lives on the assessment, instead of `parentId`/`kind`/`pick` columns.

**Build**

1. **Schema:**
   - `Question` gains `parentId`, `kind`, `label`, `answerType`, `pick`, `position`.
   - Keep `questionNumber` for top-level questions so existing rows still work.
   - Migrate each existing question to one QUESTION leaf with `label = String(questionNumber)` and `answerType` inferred: `NUMERIC` if its structured expectation is solvable and numeric, otherwise `DESCRIPTIVE`. The teacher can change it.
2. **Extraction** (`questionPaperExtraction/ai.ts`, `src/types/questionPaper.ts`):
   - Output the tree: sub-parts with their own marks, "OR" alternatives as a CHOICE_GROUP, and "Attempt any N" as an OPTIONAL_GROUP.
   - Also suggest an `answerType` per leaf, flagged as a suggestion the teacher confirms on the review screen.
   - Mark `uncertain` when the structure is ambiguous.
3. **Mapping and reading** use leaf labels ("3(b)", "Q.3(b)", "3 b", "iii") rather than integers. Update the answer-index mapping in `handwritten/answerReading.ts` and the structured reading prompt.
4. **Totals in code only** (D14):
   - A pure function `computeTotals(tree, leafMarks)` sums parts.
   - For CHOICE_GROUP and OPTIONAL_GROUP it counts the best `pick` attempted children and marks the rest `OVER_ATTEMPT`, kept and displayed with \* but excluded.
   - Unit-test every case: both choices attempted, neither attempted, best 5 of 7 with ties, nested parts inside a choice.
5. **EXACT_KEY marking:**
   - Code compares the normalised student answer (case, whitespace, punctuation, "(b)" vs "b" vs "B") against the key and its variants.
   - Any mismatch that is not an exact miss (e.g. spelling distance 1 to 2 from the key) is `UNSURE` for the teacher, never auto-wrong.
6. **Page markers** (`annotation/textractPage.ts`, `isQuestionMarker`) also recognise `Q.1`, `Q 1`, `Q1)`, `Ans 1`, `Ans. 1`, `Question 1`, `1(a)`, `(a)`, `a)`, `(i)`, `ii)`, and Roman numerals within a parent question's region.

**Done when** a paper with Q1 (a)(b), Q2 "(a) OR (b)", "attempt any 2 of Q3–Q5" and an MCQ section is extracted, read, marked and totalled correctly in the evaluation script, with the totals unit-tested.

**Closes:** 19, 20, 46, 50 (exact keys for names, dates and terms).

### Phase 4 — Consistent marking (3 runs, per criterion, median)

> **Status (Nov 5, 2026): built.** Per-criterion scoring, three runs, median, every run stored as `AI_RUN`. Measured spread 0 on five fixed answers (old method moved by half a mark). Not done: `response_format` json_schema, Gemini temperature change (both left for the owner). Stricter than D2: any difference between runs flags the answer (`FLAG_ANY_DISAGREEMENT`).

**Build**

1. **Replace holistic scoring** (`scoring.ts`) with per-criterion scoring:
   - The model returns, for every criterion, `met: true | false | partial` (partial only when the criterion allows half marks), plus a short evidence quote from the transcription.
   - Code adds up the marks. The model never returns a total.
2. **Three runs per answer** (D2):
   - Run them in parallel; the leaf's mark is the median of the 3 totals.
   - Flag `UNSURE` when any of these holds:
     - (a) max − min > 1 mark, or > 25% of the leaf's marks
     - (b) the final answer is correct but the mark is below full
     - (c) the reading was not high confidence
     - (d) D6 applies (correct answer, no working)
   - Store every run in `MarkEvent` (`AI_RUN`) with the model id and the provider's `system_fingerprint` when present.
3. **Do not rely on seed or temperature 0 for repeatability.** OpenRouter documents seed as not guaranteed. Keep temperature 0 for the OpenAI judge models. For the Gemini reading model, Google's Gemini 3 guidance recommends temperature 1.0 and warns that lower values may cause looping. **Test before changing:** run the reading stage at 0.1 and at 1.0 on the evaluation set, compare agreement between passes, and ask the product owner before switching.
4. **Structured output:** if OpenRouter supports `response_format: json_schema` for the models in use, use it in `callStructured.ts` for scoring and reading (check OpenRouter's docs for each model). Keep `parseAiJson` as the fallback.
5. **Marks and findings must agree:** derive findings from failed criteria plus comparison-engine errors. Never show a finding on a criterion the marking awarded.
6. **Over-maximum or under-zero model output:** with per-criterion scoring this cannot happen. If any total still falls outside [0, max], flag `UNSURE` rather than clamping silently.

**Done when** the evaluation script, run 3 times on the six papers, shows every leaf's median identical across the 3 repeats, or flagged. Record the before/after spread in the commit message.

**Closes:** 35, 36, 37, 39 (fixed at the source, not only made safe).

### Phase 5 — Reading robustness

> **Status (Nov 5, 2026): built.** Page-by-page reading, verbatim copy, struck/rough/diagram/language handling, per-answer routing, two-way mapping check. Migration `20261105120000` applied to live. Deviations: a diagram shows the whole page, not a crop; handwritten answers no longer use the older checkpoint route.

**Build**

1. **Per-leaf routing** (section 6 table): remove the whole-paper switch in `evaluation.ts:141`. Each leaf goes to its own path. The older pipeline in `assessment/pipeline.ts` then serves DESCRIPTIVE and SHORT_TEXT leaves; refactor it to per-criterion scoring from Phase 4, or retire it in favour of that.
2. **Page-by-page, region-based transcription** (removes the 8000-token whole-paper limit and the 4000-character cap):
   - First pass: locate answer regions per page (label, bounding box, continues-on).
   - Second pass: transcribe each region separately and stitch "contd." pieces in order.
   - Keep two reads per region for reconciliation.
3. **Verbatim reading:** add to the reading prompt: "Copy exactly what is written, including mistakes. Never correct arithmetic, spelling, grammar or logic." Research found models silently fix 42–66% of student errors without this instruction, and under 2% with it. Reconcile on the verbatim text.
4. **Crossed-out and rough work:**
   - The reader returns each segment with `status: active | struck | rough`, and never drops struck text.
   - Code applies these rules:
     - struck and replaced → ignore
     - struck and not replaced → mark it
     - margin rough work → never marked
     - two un-struck conflicting attempts at one answer → `UNSURE`, teacher decides
   - Show struck segments greyed out in the teacher's view.
5. **Diagrams** (D3):
   - The reader reports `containsDiagram` per region. A DIAGRAM leaf, or any answer whose marks depend on a diagram, becomes `TEACHER_ONLY` with the crop.
   - Text parts of mixed answers are still drafted, and the diagram criteria are left for the teacher.
6. **Language** (D7): the reader reports a script and language per region. Anything not English → `CANNOT_READ: language` with no AI mark.
7. **Two-way mapping check:** if the mapping stage and the reader disagree in either direction (mapping found text but the reader did not, or the reader found an answer the mapping put under another question), the answer is `UNSURE`. One direction is done already (commit `41c5063`).
8. **Shared reasoning between passes:** the two reads use the same model and prompt, so their errors correlate. Run one of the two passes with a different prompt phrasing, or a page order or resolution variation, and measure on the evaluation set whether disagreement detection improves. Keep it only if it does.

**Done when** the evaluation set includes a 3-page essay, a crossed-out attempt, a margin rough-work calculation, a diagram answer and a Hindi answer, and each is handled as above.

**Closes:** 26, 27, 28, 29, 30, 31, 32 (partly, see Phase 7), 49.

### Phase 6 — Findings, verification and the marked copy

> **Status (Nov 5, 2026): built.** Student-side and explanation checks in code, circles only when unambiguous, redundant variables skipped, aliases, problem-type rule removed. The marked copy now draws a mark only where the question's own marker was found and tells the teacher what it could not place.

**Build**

1. **Verifier checks the student side too** (`verificationAgent.ts`): besides re-deriving the correct value, confirm the quoted student value appears in the region's verbatim transcription (string match in code first, model second). If it does not, drop the finding.
2. **Explanations must match findings** (`explanationGenerator.ts`): after generation, check in code that every number in an explanation is either the finding's expected value or its actual value. Otherwise fall back to the deterministic wording.
3. **Circle placement** (`annotation/textractPage.ts`, `locateTextOnPage`): when the wrong value occurs more than once in the answer region, circle it only if exactly one occurrence sits on the line the finding refers to. Otherwise draw no circle and leave the teacher's note.
4. **Redundant findings:** skip a rubric variable whose value equals the final answer (e.g. `R_eq`), because the final-answer finding already covers it.
5. **Problem type:** delete the maths-only `ProblemType` list and the "problem types disagree → fail verification" rule. Replace it with nothing, or with the leaf's `answerType`. Today it can fail a whole question on a classification guess.
6. **Variable aliases:** the scheme may list aliases per quantity (`u` = `v0` = `initial velocity`). Teach `lookupStudentValue` in `comparisonEngine.ts` to use them.

**Done when** every finding on a released copy was kept by a teacher (D5) and passes checks 1 to 3, with unit tests for 1, 2 and 4.

**Closes:** 17, 18, 22, 41, 44, 47.

### Phase 7 — Remaining number forms, and validation before launch

> **Status (Nov 5, 2026): code built; launch validation blocked on the owner.** Parser forms, calibration panel, `metrics.ts`. Metrics so far are on synthetic sheets only (`scripts/eval/RESULTS.md`); the golden set of real double-marked scripts has not been supplied, so there is no launch go/no-go number yet. Percent and decimal-comma need a per-question setting that is not stored yet.

**Build**

1. **Parser** (`numericExpression.ts`); keep every Appendix A case passing:
   - `√` and `π` (`2√3`, `4π`, `π/2`) evaluated numerically
   - mixed numbers `2 1/2`
   - percentages, only when the scheme says a percentage answer is accepted for that question
   - multi-value answers (`x = 2 or −3`, `±2`) compared as sets
   - a single trailing letter (`4x`) stops being treated as a unit: only whitelisted unit symbols are stripped, and `5 g` and `2 m` must keep working
   - decimal comma only when the scheme declares it
2. **Golden set from real scripts** (the product owner provides the scripts):
   - About 20 real scanned scripts per subject: Maths, Physics, Chemistry, Biology, English and History or Social Science.
   - Each script is double-marked by two teachers.
   - Store them outside the repo, with only a manifest in the repo.
3. **Metrics script** (`scripts/eval/metrics.ts`) reports per subject:
   - agreement with teachers (exact, and within ±1 mark)
   - the false-finding rate on correct answers (**target 0**)
   - the flag rate
   - repeat stability (3 full repeats)
   - cost and time per script
4. **Calibration** (spec Stage 4): for each new scheme or teacher, compare the first 10–20 scripts with the teacher's own marks. If agreement is below the school's bar, the question is marked by hand.

**Done when** the metrics script runs on the golden set and the numbers are recorded in `scripts/eval/RESULTS.md`. The go/no-go bar is the product owner's call; present the numbers and ask.

**Closes:** 6, 7, 8, 32.

---

## 8. Out of scope for this plan

These are in `05-workflow.md` but are not needed to make marking correct. Do not build them here:

- scanning partners and bulk scanning
- roster import and roll-number page matching (Stage 2)
- moderation (Stage 5)
- parent and WhatsApp release
- PDF printing
- ERP export
- DPDP data handling (Stage 8)
- pricing

---

## 9. Issue catalog and where each is fixed

Status: ✅ fixed in `41c5063` · phase number = fixed in that phase.

| # | Issue | Status / phase |
| --- | --- | --- |
| 1 | Compound units (`m/s²`, `Ω`, `°C`) not understood | ✅ |
| 2 | `x = 4`, `Ans: 4`, `∴`, `a = 20/5 = 4` not understood | ✅ |
| 3 | Typeset minus `−5` | ✅ |
| 4 | Thousands separators | ✅ |
| 5 | Scientific notation and powers | ✅ |
| 6 | `4x` read as 4 (single trailing letter dropped) | 7 |
| 7 | `%`, mixed numbers, decimal comma, `√`, `π`, recurring decimals | 7 |
| 8 | Multi-value answers (`or`, `±`, sets, coordinates) | 7 |
| 9 | Non-numeric correct answer → "missed step a" | ✅ |
| 10 | Unnamed substitution → "missing m, g, h" | ✅ |
| 11 | Correct rounding flagged wrong | ✅ |
| 12 | 0.002 = 0.008 under the fixed floor | ✅ |
| 13 | Case collisions M/m, V/v, T/t | ✅ |
| 14 | Missing-step claims when the answer is unreadable or unconfirmed | ✅ |
| 15 | Correct value in another unit called wrong (interim suppression in place) | 2 |
| 16 | Wrong or missing unit not checked | 2 |
| 17 | Rubric lists the answer as a variable (redundant finding) | 6 |
| 18 | Student uses different variable names | 6 |
| 19 | Multi-part questions not modelled | 3 |
| 20 | Internal choice and optional questions not modelled | 3 |
| 21 | Follow-through / method-mark conventions | 2 |
| 22 | Maths-only problem-type list fails whole questions | 6 |
| 23 | Value read differently by the two passes still claimed | ✅ |
| 24 | Single-pass or low-confidence reading still claimed | ✅ |
| 25 | Mapping found writing, reader said "not attempted" → silent 0 | ✅ |
| 26 | Crossed-out work and multiple attempts | 5 |
| 27 | Both reads share the model and prompt (correlated errors) | 5 |
| 28 | Diagrams marked from text only | 5 (D3) |
| 29 | Long answers truncated; long papers may fail to read | 5 |
| 30 | Non-English answers | 5 (D7) |
| 31 | Answers out of order or under the wrong number (reverse direction) | 5 |
| 32 | Only tested on a synthetic handwriting font | 7 |
| 33 | Text mark (`"3"`) → silent final 0 | ✅ |
| 34 | Student-written instructions to the marker | ✅ |
| 35 | Marks not repeatable (4,4,3,3,4) | 1 (safe) → 4 (fixed) |
| 36 | Systematic harshness or leniency | 1 (safe) → 4 + 7 calibration |
| 37 | Marks and findings can contradict | 4 |
| 38 | Fractional marks such as 2.37 | 2 (D12) |
| 39 | Marks above maximum silently capped | 4 |
| 40 | Correct answer with no working | 2 (D6) |
| 41 | Verifier never checks what the student wrote | 6 |
| 42 | Unconfirmed findings circled on the student's page | 1 (D5) |
| 43 | Findings stored but never shown | 1 |
| 44 | Feedback not checked against findings | 6 |
| 45 | Page total denominator excluded unanswered questions | ✅ |
| 46 | Question-label formats (`Q.1`, `1(a)`, Roman numerals) not recognised | 3 |
| 47 | Circle may land on the wrong occurrence of a value | 6 |
| 48 | Total drawn before review is finished | 1 |
| 49 | One checkable question routes the whole paper | 5 |
| 50 | Names, dates and terms marked "checkable" but not checkable | 3 |
| 51 | Rubric from question text only; no teacher approval | 2 |
| 52 | Unanswered question shows PENDING forever | 1 |
| 53 | Both reads fail → submission stuck in PROCESSING | 1 |

---

## 10. Questions to ask the product owner when you reach them

Not decided yet. Ask at the start of the phase named.

- **Phase 1:**
  - Is a class the unit of confirmation, or the whole assessment? Check whether one assessment can span several sections.
  - Is a "reason" required when changing a mark on unit tests, or only on exams?
- **Phase 2:**
  - The school-wide default follow-through rule (spec example: "allowed in maths").
  - The default unit mark (½?) when the board scheme is silent.
- **Phase 4:**
  - Confirm the per-run cost increase after measuring it on the evaluation set.
  - Whether to switch Gemini's temperature (see Phase 4, step 3).
- **Phase 7:** the go/no-go bar for launch (e.g. ≥ 90% within ±1 mark, 0 false findings on correct answers, ≤ 30% flag rate).

---

## Appendix A — Number-reading cases (`parseNumericExpression`)

**A.1 Must keep the old result:**

| Input | Result |
| --- | --- |
| `"4"` | 4 |
| `"8"` | 8 |
| `"1/2"` | 0.5 |
| `"5/12"` | 0.41666… |
| `"(15-9)/(30-10-8)"` | 0.5 |
| `"20 x 10"`, `"20 × 10"`, `"20 X 10"` | 200 |
| `"34.17 approximately"` | 34.17 |
| `"36.67 marks (approximately)"` | 36.67 |
| `"0.25 mol"` | 0.25 |
| `"120 J"` | 120 |
| `"10 ohm"` | 10 |
| `"2000 g"` | 2000 |
| `"5 cm"` | 5 |
| `"30-40"` | −10 (known limitation) |
| `"-5"` | −5 |
| `"+5"` | 5 |
| `"1.5"` | 1.5 |
| `"((2))"` | 2 |
| `"3 - -2"` | 5 |
| `"007"` | 7 |
| `"4."` | 4 |
| `"9.81"` | 9.81 |
| `"12 kg"` | 12 |
| `"7 days"` | 7 |
| `"1/2 m"` | 0.5 |
| `"2x"` | 2 (old behaviour; Phase 7 changes it to null) |
| `"2e"` | 2 (same as `"2x"`) |
| `""`, `"abc"`, `"x"`, `"3x^2"`, `"2x+3"`, `"three"`, `"1/0"`, `"(4"`, `"4)"`, `"a/b"`, `"2 1/2"`, `"50%"`, `"π"`, `"√2"` | null |

**A.2 New behaviour (`41c5063`):**

| Input | Result |
| --- | --- |
| `"4 m/s^2"`, `"4 m/s²"`, `"(20-0)/5 m/s^2"` | 4 |
| `"9.8 m/s²"` | 9.8 |
| `"10 Ω"`, `"10Ω"` | 10 |
| `"37 °C"` | 37 |
| `"5 N/m²"` | 5 |
| `"20 kg m/s"`, `"20 kg·m/s"` | 20 |
| `"3 J/(kg K)"` | 3 |
| `"100 kPa"` | 100 |
| `"5 µF"` | 5 |
| `"3 m s^-1"`, `"3 m s⁻¹"` | 3 |
| `"25 km/h"` | 25 |
| `"x = 4"`, `"x=4"`, `"Ans: 4"`, `"Answer = 4"`, `"∴ x = 4"`, `"= 4"`, `"a = (20-0)/5 = 4"`, `"a = (v-u)/t = (20-0)/5 = 4 m/s²"` | 4 |
| `"therefore 12"` | 12 |
| `"P(prime) = 1/2"` | 0.5 |
| `"R_eq = 2.4 Ω"` | 2.4 |
| `"−5"` | −5 |
| `"x = −3"` | −3 |
| `"1,000"` | 1000 |
| `"1,00,000"` | 100000 |
| `"12,345.6"` | 12345.6 |
| `"3 x 10^8"`, `"3.0 × 10⁸ m/s"`, `"3e8"` | 3e8 |
| `"1.6E-19"`, `"1.6 × 10^-19 C"` | 1.6e−19 |
| `"6.02 × 10²³"` | 6.02e23 |
| `"2^3"` | 8 |
| `"-2^2"` | −4 |
| `"10^(-3)"` | 0.001 |
| `"5 eV"` | 5 |
| `"x = 3 + 4 = 8"`, `"2x + 3 = 11"`, `"2x = 8"`, `"x >= 4"`, `"x ≥ 4"`, `"x ≠ 4"`, `"x = 2 or x = -3"`, `"2,5"`, `"2, 5"`, `"1,2,3"`, `"x^2"`, `"2x^2"`, `"10^999"`, `"4 foo/bar"`, `"4 q/s"`, `"5 apples/day"`, `"m/s^2"`, `"Ω"`, `"4 m//s"`, `"4 m/s^"` | null |

## Appendix B — Comparison-engine scenarios (`compareReadingToRubric`)

Build a reading with `secondPass` equal to the main pass unless stated otherwise. "rubric" gives `correctAnswer` and the approach variables.

| Scenario | Student wrote | Rubric | Expected result |
| --- | --- | --- | --- |
| Correct, compound unit, values unnamed | `a = (v - u)/t = (20 - 0)/5 = 4 m/s^2`, answer `4 m/s^2` | 4; u=0, v=20, t=5 | no errors |
| Correct, `x = 4` | `2x + 3 = 11 / 2x = 8 / x = 4`, answer `x = 4` | 4; a=2, b=3, c=11 | no errors |
| Balanced equation | answer `2H2 + O2 -> 2H2O` | `2H2 + O2 -> 2H2O`; a=2, b=1, c=2 | `skipped_not_numeric` |
| Name answer | `Sardar Patel` | `Jawaharlal Nehru` | `skipped_not_numeric` |
| Unnamed substitution, slip | `W = mgh = 2 x 10 x 5 = 120 J` | 100; m=2, g=10, h=5 | `ARITHMETIC_ERROR` only |
| Genuinely missing value | `W = mg = 2 x 10 = 20 J` | 100; m=2, g=10, h=5 | `MISSING_STEP(h)`, `ARITHMETIC_ERROR` |
| Named wrong substitution | vars m=3, g=10, h=5; answer 150 | 100; m=2, g=10, h=5 | `WRONG_SUBSTITUTION(m)`, `FINAL_ANSWER_ERROR` |
| Case collision M vs m | vars m=40, n=0.05; answer `2 g` | 2; M=0.2, n=0.05 | no errors |
| Rounded 1 d.p. | answer `2.4` | 2.449 | no errors |
| Rounded 2 d.p. | answer `0.33` | 1/3 | no errors |
| Whole number for 2.45 | answer `2` | 2.45 | `ARITHMETIC_ERROR` (+ `MISSING_STEP` if a rubric value is absent) |
| Scientific notation | answer `3 x 10^8 m/s` | 3e8 | no errors |
| Sign error | answer `x = 3` | −3 | `SIGN_ERROR` |
| Passes disagree on answer (7 vs 1) | answer 7, second pass 1 | 1; a=1 | no errors |
| Passes disagree on a value | m=5 vs second pass m="S" | 100; m=2 | no `WRONG_SUBSTITUTION` |
| Other pass found the value | second pass has h=5; answer 50 | 100; h=5 | `ARITHMETIC_ERROR` only |
| Only one pass | `secondPass: null`, agreement low | 100; m=2 | `skipped_low_confidence` |
| Low structure confidence | `structureConfidence: low` | 100; m=2 | `skipped_low_confidence` |
| Unit conversion | answer `2000 mg` | 2 | no errors (Phase 2: no errors via real conversion) |
| Percent | answer `50%` | 0.5 | no errors |
| Tiny values | answer `0.002` | 0.008 | `ARITHMETIC_ERROR` |
| Equation as final line | answer `2x = 8` | 4; a=2 | no errors |

## Appendix C — Evaluation harness (`scripts/eval/`)

`scripts/eval/` holds the files used to test the pipeline across subjects on Nov 4, 2026:

- `papers.json`: seven synthetic papers (Mathematics control, Physics, Chemistry, Biology, English, History, and a prompt-injection paper). Each question has the student's answer lines and a "truth" note.
- `render.ps1`: draws each paper's answers in a handwriting font (Windows "Ink Free") on lined paper. `powershell -File scripts/eval/render.ps1 -Spec scripts/eval/papers.json -OutDir scripts/eval/sheets`.
- `harness.ts`: runs rubric generation → structured reading → correction on each sheet with real models and prints one line per question. It points `DATABASE_URL` at a dead address so nothing is written to the database. `npx tsx --tsconfig tsconfig.json scripts/eval/harness.ts [paperKey ...]`.
- `stability.ts`: marks fixed answers 5 times with one fixed rubric to measure run-to-run spread.

**Results on Nov 4, 2026 (after `41c5063`), for comparison:**

- No false findings remained on correct answers.
- The prompt injection was ignored (0/3 and 1/4).
- With one fixed rubric, five runs gave:

  | Answer | Marks across 5 runs |
  | --- | --- |
  | Chemistry, balanced equation | 4, 4, 3, 3, 4 |
  | Physics, W = mgh with an arithmetic slip | 3, 3, 3, 2, 3 |
  | History, two correct causes | 3, 3, 3, 3, 3 (consistently harsh) |

  This is the baseline Phase 4 must beat.

## Appendix D — Research behind the decisions

| Topic | What others do | Source |
| --- | --- | --- |
| Teacher sign-off before release | Gradescope "Publish grades"; Writable "draft scores"; CoGrader "nothing goes to students without your sign-off"; Eklavvya admin publishes | help.gradescope.com/article/sr7x5r3ryw, intercom.help/writable, cograder.com, help.eklavvya.com |
| Repeat marking and review routing | Grade k times, flag spread; checklist rubrics more consistent than holistic; the UC Irvine handwritten-calculus study ran 3×, flagged "correct answer but not full credit" and "runs disagree", and got 90% within ±1 mark | arxiv.org/html/2410.19409v1, arxiv.org/html/2603.00895v1, arxiv.org/abs/2604.12227, arxiv.org/html/2603.13083 |
| Temperature and seed | OpenRouter: seed not guaranteed; Google: keep Gemini 3 at temperature 1.0 | openrouter.ai/docs/api-reference/parameters, docs.cloud.google.com (Gemini 3 prompting guide) |
| Units and tolerance | STACK, Pearson Mastering and Moodle convert to SI; WebAssign tolerance ±2%, significant figures optional | docs.stack-assessment.org/en/Topics/Units, help.pearsoncmg.com/mastering, docs.moodle.org/39/en/Numerical_question_type |
| Internal choice | CBSE 2026: mark both, count the higher, the other shown with \* as "over attempt" | school.careers360.com (CBSE 2026 clarification); edurev.in (2026 marking-scheme instructions) |
| Crossed-out work | Cambridge: replaced → ignore, not replaced → mark, two live attempts → no mark; Edexcel similar | Cambridge 2023 mark schemes (cambridgeinternational.org), Pearson general marking guidance |
| Diagrams | Best vision model 78% vs humans 83% on hand-drawn diagrams; no product auto-marks them | arxiv.org/html/2601.06944v1 |
| Transcription correcting students | Models fixed 42–66% of student errors; an explicit "do not correct" instruction cut it below 2% | aclanthology.org/2026.emnlp-main.476, arxiv.org/html/2603.00895v1 |
| Audit trail | Eklavvya keeps the AI score, the override and the re-evaluation; Gradescope keeps none, so a full trail is a selling point | help.eklavvya.com, smu.edu Gradescope FAQ |

Unverified items in the research: Gradescope's own pages blocked automated access, so its points come from search summaries and university guides. No official CBSE rule on crossed-out work was found. The ICSE choice rule was not found.
