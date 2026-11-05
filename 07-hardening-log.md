# Hardening build log — Phases 2 to 7

Nov 5, 2026 · Branch `feature/correction-hardening` (from `feature/question-generation` at `b12e713`) · worktree `E:\ab-hardening`

This is the record of everything that went wrong, was surprising, or needs the owner's decision while building Phases 2 to 7 of `06-correction-hardening-plan.md`. It is written to be read once, at the end.

`05-workflow.md` was re-read before starting. Its rule runs through every entry: **the AI drafts, the teacher decides.** Its two open points (students writing their own roll number; printing the marked copy) are not built and not touched.

## Where things stand

All six phases are built, tested (852 unit tests, `tsc` and `eslint` clean) and committed. Every migration is applied to the live database. The screens were clicked through in a browser at the end (see "The final browser walkthrough"). What has not happened yet is the owner's review.

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

## Problems found while building: 50 (problems 5, 6, 8, 9, 42, 47, 48 and 49 were fixed in later batches)

**30 fixed · 15 accepted, decided or observations · 5 open (need you, or a later fix).** Problems 39 to 50 came from the final browser walkthrough, described in its own section below the deviations.

### Found when the Phase 1 screens were clicked through in a browser

| # | Problem | Status |
| --- | --- | --- |
| 1 | On the marked copy, questions whose number could not be found were drawn at one guessed spot, stacked on top of each other; a kept mistake's ring was silently missing. | **Fixed (Phase 6).** A mark is drawn only where the question's own marker was found; after release the teacher is told which questions and kept mistakes could not be placed. |
| 2 | Page markers like `Q1.` were not recognised, and a marker the text detector was unsure of is skipped. | **Fixed for the forms** (Phase 3: `Q.1`, `Q 1`, `Q1.`, `Ans 1`, `1(a)`, `(a)`, `ii)`…). A low-confidence marker is still skipped on purpose; it is now reported instead of silent (see 1). |
| 3 | The AI's "Feedback" paragraph reaches the student without the teacher approving it, and can contradict a mark the teacher changed (Q2 was changed from 4 to 1; the student still read text written for 4). | **Fixed (owner decision, Nov 5).** The AI's feedback reaches the student only while you accepted its mark. Once you change the mark it is withheld and your own comment is shown; the comment box on the review screen says so. |
| 4 | The history showed a raw "teacher_finding on question 1". | **Fixed.** Every event kind now has a plain description. |
| 5 | The "Question 1 has not been checked yet" box stays on screen after the question is checked, until the next confirm attempt. | **Fixed.** A refusal is hidden as soon as the answers change (second batch). |
| 6 | Before release the student sees "Not evaluated yet / still being marked" on every answer while the banner says the teacher is reviewing. | **Fixed.** Once marking has finished but nothing is released, every answer says "With your teacher" and one line that the mark appears on release. |
| 7 | A question the student never answered was reported as "still being evaluated". | **Fixed.** It now says "not answered". |
| 8 | Each release leaves the previous marked image file on disk (the database pointer is cleared; the file is not deleted). | **Fixed.** The files of the copies a release clears are deleted after it commits; a redrawn copy deletes the one it replaces. |
| 9 | The total circle can overlap the header text on the marked copy. | **Fixed.** The total goes in the first spot that covers no writing, tick or circled mark: top right, middle, top left, then down the right edge. |

### Phase 2 — teacher approves every scheme

| # | Problem | Status |
| --- | --- | --- |
| 10 | The manual rubric editor lost data on every save: it dropped the expected answer, partial-credit guidance, structured expectation, and each approach's steps and primary flag. That silently changed how a question was routed and marked. | **Fixed.** Every save is a new version that carries everything forward. |
| 11 | Every existing rubric on the live database is now "waiting for approval" (the migration deliberately does not backfill, because that would claim a teacher approved something they did not). A *new* student submission to an already-published assessment is parked for the teacher until its schemes are approved. The 9 existing submissions are unaffected. | **Decided: keep.** Existing rubrics stay "waiting for approval"; nothing is approved for you. Approve each paper once with "Approve all". |
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
| 21 | A half-mark difference between the three runs is under D2's threshold, but made the median flip between repeats. | **Decided: keep.** Any difference between the three runs flags the answer for launch. |
| 22 | One malformed model reply cost a whole run (only network errors were retried). | **Fixed.** Retried within the run. |
| 23 | "Final answer could not be checked automatically" fired when the key was simply not a number. | **Fixed.** |
| 24 | The scheme drafter gives a different scheme each time it runs, so marks differ between sessions. | **Observation.** The teacher's approval is what settles it. |
| 25 | The model chose "partial" on 1-mark criteria, a source of half-mark noise. | **Fixed.** Partial is allowed only for criteria worth 2 marks or more. |

### Phase 5 — reading

| # | Problem | Status |
| --- | --- | --- |
| 26 | One checkable question sent a whole paper down one route; a paper with none sent numeric working down the other. | **Fixed.** Each answer is routed by its own question. |
| 27 | The old checkpoint route (used for explanations before) had "novel approach" detection. Handwritten answers no longer use that route. | **Fixed (owner decision, Nov 5).** When the final answer is right but marks were lost and there is working, the AI says whether the different method looks valid, and the answer is flagged for you either way. The mark is never changed by it. |
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
| 36 | Flag rate 40 to 50% on the synthetic sheets, above the plan's 30% example bar. | **Decided: keep.** See 21. Revisit once real double-marked scripts show how often the AI is right. |
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

## The final browser walkthrough (problems 39 to 50)

Done in a throwaway copy of the app on a scratch database schema, never the live one. A two-page handwritten sheet was drawn (a crossed-out MCQ answer, margin rough work, both choices of an "(a) OR (b)" answered, a diagram), the schemes were drafted by the real model, and the sheet was read and marked by the real pipeline. Then the teacher flow was clicked through: scheme approval, review, confirm, release, the student's results and the submissions page.

| # | Problem | Status |
| --- | --- | --- |
| 39 | The confirm-marks list said "Question 6 has no mark yet" when the paper calls that question "Question 4". Messages used the internal number, not the label ("1(a)", "4"). The same slip was in the readiness messages, rubric pages, dashboard, review queue, student question paper and the per-question score chips. | **Fixed.** Labels are used everywhere; a unit test covers the confirm list. |
| 40 | Rough work was drawn struck through, so it looked like crossed-out work (the label beside it was struck as well). | **Fixed.** Only crossed-out work is struck through; rough work is just greyed. |
| 41 | "1 marks" instead of "1 mark" on the question cards, the student's paper and results, and the teacher's review. | **Fixed.** |
| 42 | A mistake the AI listed ("You did not include θ = 0°") sits beside a scheme item about that angle that was awarded. The mark is right; the two read as contradicting each other. | **Fixed.** A "you did not write X" mistake is dropped when an awarded scheme item names X (its variable or its expected value as a whole word). |
| 43 | The AI drafted "Newton's second law" as three equal key points, including "rate of change of momentum", so the plain answer "force equals mass times acceleration" got 1.5 of 3. The scheme is a draft; this is why the teacher approves it. | **Observation.** Not a code fault. |
| 44 | One rubric draft failed ("Could not extract valid JSON from the AI response") and showed the existing Retry button. | **Observation.** Handled, but it shows the scheme drafter occasionally returns unusable output. |
| 45 | The OpenRouter key refused the old whole-sheet reading call: "can only afford 32550 tokens" while that call asks for up to 65,536. This is a limit on the key, not a code fault, and the call is old code (Phase 5 did not touch it). For the walkthrough the reading summary was written by hand and the new page-by-page reading and marking ran for real. | **Needs you.** Check the key's credit limit before testing live. The old call asks for far more tokens than it uses. |
| 46 | A question whose own marker was crossed out (the MCQ "3. C" struck, then "B") gets no mark drawn on the copy. The release message says so, and its mark is still in the total and the student's results. | **Accepted** (a mark is never drawn at a guessed spot). |
| 47 | On the marked copy, the mark symbols sit on top of the question label ("1(a)") and the total circle covers the "Page 1/2" header on this sheet. Where the margin is wider on a real sheet this may not happen. | **Fixed.** The tick, double stroke or cross is drawn in the margin left of the question's own marker; the old fixed span is used only when that margin is too narrow. |
| 48 | The scheme panel's "Follow-through" setting is shown for descriptive questions where it means nothing, and the rubric is shown twice (as the rubric and again as the marking scheme). | **Fixed.** The two rules show only for a calculation (working plus a final answer); other questions say there is nothing to set. The marking breakdown is no longer listed twice. |
| 49 | The scheme-approval list showed "1 approach · 0 checkpoints" for an exact-answer (MCQ) scheme. | **Fixed.** The card counts "marking points" from the scheme, so an exact-answer question shows 1, not 0. |
| 50 | The unused older typed-answer form (`AnswerForm.tsx`) still shows the question number. It is not shown anywhere. | **Left as is.** |

**Checked and fine in the browser:** the approval panel counts and the blocked Publish button; "Approve this scheme" recording the approval; the review screen (criteria with evidence, three runs, greyed rough work, kept/removed mistakes, diagram sent to the teacher with the page shown, over-attempt note); the early "Confirm" being refused with a list; "Accept all sure answers"; the total (8.5 of 11: the better of 2(a) and 2(b) counts, the other kept with a star); confirm, then release; the released message about the mark that could not be placed; the student's marked copy and results (star and note on the over-attempt, the teacher's diagram mark); the submissions page and its calibration panel (it waits for 10 reviewed answers before showing agreement).

**Not clicked in the browser:** the paper-review screen for a paper with parts and choices (covered by unit tests and a real extraction run in Phase 3), and the "scheme changed after marking" flag.

## Not verified, and why

- **The paper-review screen with parts and choices** and **"scheme changed" after marking** were not opened in a browser (see above).
- **Real handwriting accuracy**: only synthetic clean-font sheets exist (problem 34).
- **The 9 live submissions** were never re-marked with the new scheme and routes; nothing here touches them.
- **Marked copy on real scans**: marker placement is tested on synthetic sheets and in unit tests; real photographs are untested.
- **Typed-answer assessments** still use the old pipeline; they were left alone.
