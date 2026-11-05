# Evaluation results

Numbers from `scripts/eval/` runs. **Read the limits first.**

## What these numbers are not

They are **not** the launch-readiness numbers the plan asks for. Those need about 20 real scanned scripts per
subject (Maths, Physics, Chemistry, Biology, English, History or Social Science), each marked by two teachers.
The owner supplies those scripts; none have been provided yet, so `metrics.ts` has only been run on the
**synthetic** sheets in `papers.json`: one clean-font sheet per subject, with marks written from the "truth" note
beside each answer, not by teachers. They show the script works and give a first read; they say nothing reliable
about real handwriting.

## Marking steadiness (Phase 4): `stability.ts`

Five fixed answers, five repeats each, one rubric per answer. The old way is one holistic mark per call.

| Answer | Old, five repeats | New (criteria, median of 3), five repeats |
| --- | --- | --- |
| Chemistry, balanced equation | 4, 4, 4, 4, 4 (the plan's earlier run: 4, 4, 3, 3, 4) | 4, 4, 4, 4, 4 |
| English, idiom | 3, 3, 3, 3, 3 | 3, 3, 3, 3, 3 |
| History, two causes | 3, 3, 3, 3, 3 | 3, 3, 3, 3, 3 |
| Physics, W = mgh with a slip | 2, 2, 2, 2, 2.5 (earlier: 3, 3, 2.5, 2.5, 2.5) | 2.5, 2.5, 2.5, 2.5, 2.5 |
| History, two social effects (6) | 3, 3, 3, 3, 3 | 3, 3, 3, 3, 3 |

Spread of the new method: 0 on every answer. The old method moved by half a mark on Physics. The scheme drafter
also changed during this work (it had put marks on "verifies the atoms balance", scoring a correct equation 2/4),
so rubrics differ between sessions; a different draft of the scheme is itself a source of variation, which is
why the teacher approves it.

## Page-by-page reading (Phase 5): `phase5/`

One three-page synthetic sheet: a crossed-out answer that is replaced, margin rough work, a diagram, a Hindi
answer, and an essay across three pages. Every case was handled as intended (see `phase5/README.md`).

## Metrics on the synthetic sheets (Phase 7): `metrics.ts`

Physics and Chemistry sheets, one script each, 3 repeats, Nov 5, 2026. "Teacher" marks are synthetic.

| Subject | Exact | Within 1 mark | False findings on correct answers | Flag rate | Repeat stability | Time and cost per script |
| --- | --- | --- | --- | --- | --- | --- |
| Physics | 25% (1/4) | 100% (4/4) | 0% (0/1) | 40% (2/5) | 100% | 26 s, $0.028 |
| Chemistry | 50% (2/4) | 100% (4/4) | 0% (0/3) | 50% (2/4) | 100% | 26 s, $0.027 |

Reading this honestly:

- **False findings on correct answers: 0**, the plan's target, on a very small sample.
- **Within one mark: 100%**, above the plan's example bar of 90%, on 8 answers. Meaningless at that size.
- **Flag rate 40 to 50% is above the plan's example bar of 30%.** The flags are real borderline calls: the three
  marking runs disagreed by half a mark or a mark, or a correct final answer did not earn full marks. A stricter
  rule than decision D2 is on (any difference between runs flags the answer; `FLAG_ANY_DISAGREEMENT`), which raises
  the flag rate on purpose. Switching it off follows D2 exactly and flags fewer answers, at the cost of a median
  that can move by half a mark between repeats. **This trade-off is the owner's to decide.**
- **Cost about $0.03 and about 26 seconds per one-page script**, measured for a handful of questions per page.
  A 16-page term booklet reads 16 pages twice, so expect several times that.

The go or no-go bar for launch is the owner's call.
