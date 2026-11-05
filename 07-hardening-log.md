# Hardening build log — Phases 2 to 7

Nov 5, 2026 · Branch `feature/correction-hardening` (from `feature/question-generation` at `b12e713`) · worktree `E:\ab-hardening`

This is the record of everything that went wrong, was surprising, or needs the owner's decision while building Phases 2 to 7 of `06-correction-hardening-plan.md`. It is written to be read once, at the end.

`05-workflow.md` was re-read before starting. Its rule runs through every entry: **the AI drafts, the teacher decides.** Its two open points (students writing their own roll number; printing the marked copy) are not built and not touched.

## Where things stand

All six phases are built, tested (851 unit tests, `tsc` and `eslint` clean) and committed. Every migration is applied to the live database. What has not happened yet is the owner's review, and a final click-through of the screens in a browser (see "Not verified").

## The owner's decisions, in one place

These are the items that are genuinely yours. Everything else in this log is either fixed or an accepted limitation.

1. **Existing rubrics on the live database are "waiting for approval"** (problem 11). Keep it, or approve them for the teacher?
2. **AI feedback text reaches the student unapproved** (problem 3). Hide it unless the teacher approves it, or show it?
3. **How strict to be about disagreement between the three marking runs** (problems 21 and 36). Today any difference flags the answer for the teacher. That gives a flag rate of 40 to 50% on the synthetic sheets, against a 30% example bar in the plan. Following D2 exactly flags less but lets a mark move by half a mark between repeats. One constant, `FLAG_ANY_DISAGREEMENT`.
4. **"Novel approach" detection no longer runs on handwritten answers** (problem 27). Keep that, or bring it back for calculations?
5. **The agreement line for calibration** (default 80% within one mark) and **the launch bar** (plan example: 90% within one mark, 0 false findings, 30% flag rate).
6. **The real double-marked scripts** (problem 34), without which the launch numbers cannot be measured.
7. **Percent and decimal-comma answers** (problem 33): a per-question setting that is not stored yet.
8. **Defaults I picked** (table below): follow-through allowed, final-answer-only for a correct answer with no working, half-mark unit step, a teacher's save counts as approval.

## How the work is kept safe

- **Separate worktree and branch.** The owner's dev server on port 3000 runs from `E:\Assessment Brain` against the live database. Regenerating the Prisma client there would break it at its next restart. This worktree has its own `node_modules`.
- **Migrations.** The owner said "feel free to run any migrations" (Nov 5). Each one was tested from zero in a throwaway schema first, then applied with `prisma migrate deploy`. All are additive (columns, tables, enum values), so the old code on port 3000 is unaffected.
- **Unit tests never call a model.** Only the opt-in scripts in `scripts/eval/` do, and they never write to the database.

## Migrations applied to the live database

| Migration | Phase | What it does | Applied |
| --- | --- | --- | --- |
| `20261104180000_add_mark_release_and_audit` | 1 | release and confirmation columns; append-only `MarkEvent` table | Nov 4 |
| `20261105100000_add_scheme_criteria_and_approval` | 2 | scheme criteria, follow-through and no-working rules, teacher approval on a rubric version, review reasons `SCHEME_NOT_APPROVED`, `SCHEME_CHANGED` | Nov 5 |
| `20261105110000_add_question_labels_and_tree` | 3 | question label and answer type, the paper's structure on the assessment | Nov 5 |
| `20261105120000_add_review_reasons_for_diagrams_and_language` | 5 | review reasons `DIAGRAM_TEACHER_ONLY`, `UNSUPPORTED_LANGUAGE` | Nov 5 |

After each: 16 users, 9 submissions, 48 responses, 0 mark events, 0 released — unchanged. Phases 4, 6 and 7 changed no schema.

## Problems found while building: 38

**17 fixed · 8 accepted or observations · 13 open (need you, or a later fix).**

### Found when the Phase 1 screens were clicked through in a browser

| # | Problem | Status |
| --- | --- | --- |
| 1 | On the marked copy, questions whose number could not be found were drawn at one guessed spot, stacked on top of each other; a kept mistake's ring was silently missing. | **Fixed (Phase 6).** A mark is drawn only where the question's own marker was found; after release the teacher is told which questions and kept mistakes could not be placed. |
| 2 | Page markers like `Q1.` were not recognised, and a marker the text detector was unsure of is skipped. | **Fixed for the forms** (Phase 3: `Q.1`, `Q 1`, `Q1.`, `Ans 1`, `1(a)`, `(a)`, `ii)`…). A low-confidence marker is still skipped on purpose; it is now reported instead of silent (see 1). |
| 3 | The AI's "Feedback" paragraph reaches the student without the teacher approving it, and can contradict a mark the teacher changed (Q2 was changed from 4 to 1; the student still read text written for 4). | **Open — decision 2.** |
| 4 | The history showed a raw "teacher_finding on question 1". | **Fixed.** Every event kind now has a plain description. |
| 5 | The "Question 1 has not been checked yet" box stays on screen after the question is checked, until the next confirm attempt. | **Open (polish).** |
| 6 | Before release the student sees "Not evaluated yet / still being marked" on every answer while the banner says the teacher is reviewing. | **Open (polish).** |
| 7 | A question the student never answered was reported as "still being evaluated". | **Fixed.** It now says "not answered". |
| 8 | Each release leaves the previous marked image file on disk (the database pointer is cleared; the file is not deleted). | **Open (minor).** |
| 9 | The total circle can overlap the header text on the marked copy. | **Open (cosmetic).** |

### Phase 2 — teacher approves every scheme

| # | Problem | Status |
| --- | --- | --- |
| 10 | The manual rubric editor lost data on every save: it dropped the expected answer, partial-credit guidance, structured expectation, and each approach's steps and primary flag. That silently changed how a question was routed and marked. | **Fixed.** Every save is a new version that carries everything forward. |
| 11 | Every existing rubric on the live database is now "waiting for approval" (the migration deliberately does not backfill, because that would claim a teacher approved something they did not). A *new* student submission to an already-published assessment is parked for the teacher until its schemes are approved. The 9 existing submissions are unaffected. | **Open — decision 1.** |
| 12 | My test helper `questions.map(questionRow)` passed the array index as the new `approved` argument; ten tests failed. | **Fixed** (test bug, mine). |
| 13 | A test said the final answer was correct while marking its criterion "no". | **Fixed** (test bug, mine). |
| 14 | `tsc` in a fresh worktree reports `LayoutProps` not found; Next.js generates that type when it runs. | **Accepted** (environment). |
| 15 | A scheme save is refused if the teacher's marks do not add up to the question (the old editor accepted any total). | **Accepted** (deliberate: marks are never adjusted silently). |

### Phase 3 — parts, choices, optional questions, exact answers

| # | Problem | Status |
| --- | --- | --- |
| 16 | The label reader took working such as `3x + 2 = 5`, `3.5 m`, `3/4`, `3 + 2` as the start of question 3. | **Fixed** (found by my own tests). A label must end cleanly. |
| 17 | Every stage identifies a question by its integer number. A paper with parts gives each part its own number (paper order) and a separate label ("2(a)"). Existing papers keep their numbers and have no label. | **Design note.** Nothing existing changes. |
| 18 | The paper-review screen cannot add, remove or renumber questions of a paper that has parts or choices (that would silently change what the paper is out of). The server refuses it too. | **Accepted.** Text and marks stay editable. |

### Phase 4 — consistent marking

| # | Problem | Status |
| --- | --- | --- |
| 19 | A fully correct balanced equation scored 2/4: the scheme drafter had put 2 marks on "verifies the atoms balance". | **Fixed.** The drafter no longer puts marks on checks students do not write. |
| 20 | That fix over-corrected: a correct method with an arithmetic slip fell to 0.5/4. | **Fixed.** Calculations keep method marks. |
| 21 | A half-mark difference between the three runs is under D2's threshold, but made the median flip between repeats. | **Open — decision 3.** Any difference now flags the answer (stricter than D2). |
| 22 | One malformed model reply cost a whole run (only network errors were retried). | **Fixed.** Retried within the run. |
| 23 | "Final answer could not be checked automatically" fired when the key was simply not a number. | **Fixed.** |
| 24 | The scheme drafter gives a different scheme each time it runs, so marks differ between sessions. | **Observation.** The teacher's approval is what settles it. |
| 25 | The model chose "partial" on 1-mark criteria, a source of half-mark noise. | **Fixed.** Partial is allowed only for criteria worth 2 marks or more. |

### Phase 5 — reading

| # | Problem | Status |
| --- | --- | --- |
| 26 | One checkable question sent a whole paper down one route; a paper with none sent numeric working down the other. | **Fixed.** Each answer is routed by its own question. |
| 27 | The old checkpoint route (used for explanations before) had "novel approach" detection. Handwritten answers no longer use that route. | **Open — decision 4.** |
| 28 | No crop of a diagram is shown to the teacher; they see the whole page. | **Accepted.** |
| 29 | Writing the mapping step missed (reader found an answer to a question with no answer row) was silently dropped. | **Fixed.** The teacher is told. |

### Phase 6 — findings

| # | Problem | Status |
| --- | --- | --- |
| 30 | A value that appears twice in an answer is no longer circled (the finding names a value, not a line), so some kept mistakes get no ring. | **Accepted** (precision over recall, D15). The teacher is told. |
| 31 | The "problem types disagree" rule failed whole questions on a guess from a maths-only list. | **Fixed.** Removed. |

### Phase 7 — number forms and validation

| # | Problem | Status |
| --- | --- | --- |
| 32 | `4x` and `2e` were read as 4 and 2. | **Fixed.** |
| 33 | Percent and decimal-comma answers are read only when asked for, but no per-question setting stores that yet, so such answers stay "cannot read" and go to a person. | **Open — decision 7.** |
| 34 | There are no real double-marked scripts, so the launch numbers cannot be measured; `metrics.ts` has run only on synthetic sheets. | **Blocked on you — decision 6.** |
| 35 | The plan asks for the full evaluation script 3 times on six papers. I ran the 5-repeat stability check and the metrics script (3 repeats, 2 papers) instead. | **Accepted.** |
| 36 | Flag rate 40 to 50% on the synthetic sheets, above the plan's 30% example bar. | **Open — decision 3.** |
| 37 | Model structured-output (`response_format: json_schema`) was not adopted: support for each configured model could not be verified without a live test per model. The JSON-extraction fallback is unchanged. | **Open.** |
| 38 | The Gemini reading model's temperature was not changed (the plan says to measure and ask first). | **Open — your call.** |

## Defaults chosen where the plan said "ask the owner"

Each needs a yes or a change at review.

| Question | Default chosen | Why |
| --- | --- | --- |
| School-wide follow-through rule | **Allowed** | The spec's own example is "follow-through allowed in maths". Settable per question. |
| A correct answer with no working (D6) | **Final-answer marks only**, and flagged | Straight from D6. Settable per question. |
| Unit mark when the scheme is silent | **0.5 mark, only for questions worth 2 or more marks** | A 1-mark question cannot be split sensibly. |
| Does a teacher saving a scheme count as approving it? | **Yes** | They wrote or reviewed it; their id and the time are recorded. |
| A scheme that changes after a mark was accepted | **The mark is not changed; the teacher gets a "scheme changed" flag** | D13: never overwrite a confirmed mark. |
| The agreement line for calibration | **80% within one mark, after 10 reviewed answers** | Between "too few" and the plan's 90% launch example. |
| Over-attempt rule for ties | **The earlier alternative counts** | A tie must be broken somehow; paper order is predictable. |

## Deviations from the plan

- **Unit handling keeps the older cautious rule for a key with no unit.** A rubric generated from now on stores its unit and gets real conversion; the 9 live rubrics have none.
- **"Draft" is a version status; assessment status `RUBRIC_REVIEW` is unused.** An unapproved version is `DRAFT` with no approval; approval sets who and when on the version itself (a `MarkEvent` needs a student answer).
- **The "scheme changed" flag does not show "draft is now X (was Y)".** That needs an unsaved marking run.
- **A rubric's unit is stored as `unit` on the expected answer**, not as `{ value, unit }`.
- **Any difference between marking runs flags the answer**, stricter than D2 (decision 3).
- **Handwritten answers no longer use the older checkpoint route** (problem 27); typed answers still do.
- **Diagram "crop" is the whole page** (problem 28).

## Not verified, and why

- **A final click-through of the screens in a browser** (assessment page with scheme approval; paper review with parts and choices; teacher review with criteria, crossed-out work and over-attempt; submissions page with calibration; student results). The unit tests and type checks cover the logic, but the screens were last opened in a browser for Phase 1.
- **Real handwriting accuracy**: only synthetic clean-font sheets exist (problem 34).
- **The 9 live submissions** were never re-marked with the new scheme and routes; nothing here touches them.
- **Marked copy on real scans**: marker placement is tested on synthetic sheets and in unit tests; real photographs are untested.
- **Typed-answer assessments** still use the old pipeline; they were left alone.
