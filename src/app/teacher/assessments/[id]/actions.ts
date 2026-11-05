"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { generateRubricForQuestion, generateAllRubricsForAssessment } from "@/lib/rubricGeneration";
import { getAssessmentReadiness, describeAssessmentReadiness } from "@/lib/assessment/readiness";
import { approveAllSchemes, approveScheme } from "@/lib/assessment/schemeApproval";
import { saveSchemeVersion } from "@/lib/assessment/schemeVersioning";
import { reapplyAfterSchemeChange } from "@/lib/assessment/schemeReapplyRunner";
import { FOLLOW_THROUGH_RULES, NO_WORKING_RULES, schemeOf } from "@/lib/scheme/criteria";
import { mergeApproachEdits, mergeCheckpointEdits, type StoredApproach } from "@/lib/scheme/merge";

export type ActionState = { error?: string; success?: boolean };

async function getOwnedAssessment(assessmentId: string, teacherId: string) {
  return prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId },
    select: { id: true },
  });
}

async function getOwnedQuestion(questionId: string, teacherId: string) {
  return prisma.question.findFirst({
    where: { id: questionId, assessment: { teacherId } },
    select: { id: true, assessmentId: true, maximumMarks: true },
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function createQuestion(
  assessmentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const owned = await getOwnedAssessment(assessmentId, session.user.id);
  if (!owned) {
    return { error: "Assessment not found." };
  }

  const questionText = String(formData.get("questionText") ?? "").trim();
  const maximumMarksRaw = String(formData.get("maximumMarks") ?? "").trim();
  const maximumMarks = Number(maximumMarksRaw);

  if (!questionText) {
    return { error: "Question text is required." };
  }
  if (!maximumMarksRaw || !Number.isFinite(maximumMarks) || maximumMarks <= 0) {
    return { error: "Maximum marks must be a positive number." };
  }

  const highest = await prisma.question.aggregate({
    where: { assessmentId },
    _max: { questionNumber: true },
  });
  const nextNumber = (highest._max.questionNumber ?? 0) + 1;

  // A companion Rubric row (status PENDING) is created alongside every
  // question, whether it comes from approved extraction or this manual
  // form, so the teacher is never asked to write a rubric by hand and so
  // the assessment-level "Generate All Rubrics" action (Phase 4.3 — see
  // generateAllRubrics below) can find and generate it later. Generation is
  // deliberately NOT triggered here: the primary workflow is one
  // intentional bulk action the teacher clicks once every question exists,
  // not an automatic per-question kickoff that would make manually-added
  // questions behave differently from extracted ones.
  await prisma.$transaction(async (tx) => {
    const created = await tx.question.create({
      data: {
        assessmentId,
        questionNumber: nextNumber,
        questionText,
        maximumMarks,
      },
    });
    await tx.rubric.create({ data: { questionId: created.id } });
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  return { success: true };
}

export async function updateQuestion(
  questionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  const questionText = String(formData.get("questionText") ?? "").trim();
  const maximumMarksRaw = String(formData.get("maximumMarks") ?? "").trim();
  const maximumMarks = Number(maximumMarksRaw);
  const questionNumberRaw = String(formData.get("questionNumber") ?? "").trim();
  const questionNumber = Number(questionNumberRaw);
  // How this question is marked. Blank means "work it out from the scheme"; the teacher's choice always wins.
  const answerTypeRaw = String(formData.get("answerType") ?? "").trim();
  const ANSWER_TYPES = ["NUMERIC", "SHORT_TEXT", "DESCRIPTIVE", "ESSAY", "EXACT_KEY", "DIAGRAM"];
  if (answerTypeRaw && !ANSWER_TYPES.includes(answerTypeRaw)) {
    return { error: "Choose how this question is marked from the list." };
  }

  if (!questionText) {
    return { error: "Question text is required." };
  }
  if (!maximumMarksRaw || !Number.isFinite(maximumMarks) || maximumMarks <= 0) {
    return { error: "Maximum marks must be a positive number." };
  }
  if (!Number.isInteger(questionNumber) || questionNumber <= 0) {
    return { error: "Question number must be a positive whole number." };
  }

  try {
    await prisma.question.update({
      where: { id: questionId },
      data: { questionText, maximumMarks, questionNumber, answerType: (answerTypeRaw || null) as never },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: `Question number ${questionNumber} is already used in this assessment.` };
    }
    throw error;
  }

  // Phase 4.4 — an edit is the primary recovery path for a flagged
  // (REVIEW_REQUIRED) or technically-failed (FAILED) rubric: clear the
  // stale status and issue details and let the question re-enter the
  // normal PENDING queue, so the next "Generate All Rubrics" actually
  // revalidates it against the edited text rather than leaving the old
  // verdict visible forever. A READY rubric is deliberately left untouched
  // — a minor text/marks tweak after a successful generation shouldn't
  // silently invalidate a working rubric; regenerating one that's already
  // READY stays a manual, explicit choice (the "Advanced: edit rubric
  // manually" override). Never marks the question valid on its own — it
  // only clears the way for a fresh validation pass to actually run.
  await prisma.rubric.updateMany({
    where: { questionId, generationStatus: { in: ["FAILED", "REVIEW_REQUIRED"] } },
    data: {
      generationStatus: "PENDING",
      generationError: null,
      validationIssueType: null,
      validationIssueSummary: null,
      validationExplanation: null,
    },
  });

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  revalidatePath(`/teacher/assessments/${question.assessmentId}/rubrics`);
  return { success: true };
}

export async function deleteQuestion(
  questionId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  try {
    await prisma.question.delete({ where: { id: questionId } });
  } catch (error) {
    // The database's own historical-data protection (QuestionResponse.question
    // is onDelete: Restrict) blocks deleting a question that already has
    // recorded student responses. Surface that as a plain explanation rather
    // than a raw constraint error.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2014")
    ) {
      return {
        error:
          "This question can't be deleted because student responses already exist for it.",
      };
    }
    throw error;
  }

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

/**
 * Deletes every Question on an assessment in one action — the bulk
 * counterpart to deleteQuestion, for a teacher who wants to clear an
 * extracted/approved batch and start over rather than deleting each one by
 * hand. Rubric/RubricVersion rows are removed automatically (Rubric.question
 * is onDelete: Cascade); nothing else needs cleaning up.
 *
 * A single `deleteMany` is tried first (the common case, and the fast
 * path). If any question already has recorded student responses,
 * QuestionResponse.question's onDelete: Restrict makes that single SQL
 * statement fail atomically — deleting nothing at all, even the questions
 * that were perfectly safe to remove. Falling back to one-at-a-time on that
 * specific failure means a teacher clearing a fresh, never-submitted-to
 * batch (the normal case this button exists for) still gets one clean bulk
 * delete, while a mixed assessment safely keeps whatever has real history
 * and reports how many were skipped, rather than either silently losing
 * data or failing the whole operation over one protected question.
 */
export async function deleteAllQuestions(
  assessmentId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const owned = await getOwnedAssessment(assessmentId, session.user.id);
  if (!owned) {
    return { error: "Assessment not found." };
  }

  const questions = await prisma.question.findMany({
    where: { assessmentId },
    select: { id: true },
  });
  if (questions.length === 0) {
    return { success: true };
  }

  try {
    await prisma.question.deleteMany({ where: { assessmentId } });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2014")
    ) {
      let deletedCount = 0;
      let skippedCount = 0;
      for (const q of questions) {
        try {
          await prisma.question.delete({ where: { id: q.id } });
          deletedCount += 1;
        } catch (innerError) {
          if (
            innerError instanceof Prisma.PrismaClientKnownRequestError &&
            (innerError.code === "P2003" || innerError.code === "P2014")
          ) {
            skippedCount += 1;
            continue;
          }
          throw innerError;
        }
      }

      revalidatePath(`/teacher/assessments/${assessmentId}`);
      revalidatePath(`/teacher/assessments/${assessmentId}/rubrics`);

      if (skippedCount > 0) {
        return {
          error: `Deleted ${deletedCount} question${deletedCount === 1 ? "" : "s"}. ${skippedCount} couldn't be deleted because student responses already exist for ${skippedCount === 1 ? "it" : "them"}.`,
        };
      }
      return { success: true };
    }
    throw error;
  }

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  revalidatePath(`/teacher/assessments/${assessmentId}/rubrics`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

type SolutionApproach = { label: string; description: string };
type MarkingCheckpoint = { description: string; marks: number };

function parseApproaches(raw: string): SolutionApproach[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { label?: unknown; description?: unknown } =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      label: typeof item.label === "string" ? item.label.trim() : "",
      description:
        typeof item.description === "string" ? item.description.trim() : "",
    }))
    .filter((item) => item.label || item.description);
}

function parseCheckpoints(raw: string): MarkingCheckpoint[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { description?: unknown; marks?: unknown } =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      description:
        typeof item.description === "string" ? item.description.trim() : "",
      marks: Number(item.marks),
    }))
    .filter(
      (item) => item.description && Number.isFinite(item.marks) && item.marks >= 0,
    );
}

/**
 * Creates a new, active RubricVersion for a question — either the question's
 * first rubric, or a new version of an existing one. Existing versions are
 * never edited in place: the prior active version (if any) is marked
 * SUPERSEDED, and Rubric.activeVersionId is repointed to the new row, all in
 * one transaction so the database's active-version composite FK is always
 * satisfied (the new version must exist before it can be pointed to).
 *
 * Kept for backward compatibility (Phase 4.1 — the normal workflow now
 * generates rubrics automatically; see src/lib/rubricGeneration) as an
 * advanced manual-override path, and for any pre-existing Question that
 * predates automatic generation and has no Rubric row yet at all (the
 * `!rubric` branch below). Also sets generationStatus to READY: a rubric a
 * teacher wrote by hand is just as ready as one the AI wrote, and should
 * never keep reading as "generating" or "failed" underneath a manual save.
 */
export async function saveRubricVersion(
  questionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  let approaches: SolutionApproach[];
  let checkpoints: MarkingCheckpoint[];
  try {
    approaches = parseApproaches(String(formData.get("approachesJson") ?? "[]"));
    checkpoints = parseCheckpoints(String(formData.get("checkpointsJson") ?? "[]"));
  } catch {
    return { error: "Rubric data was malformed. Please try again." };
  }

  if (approaches.length === 0) {
    return { error: "Add at least one accepted solution approach." };
  }
  if (checkpoints.length === 0) {
    return { error: "Add at least one marking checkpoint." };
  }

  // The editor only knows descriptions and marks. Fold its changes into what is already stored, so the
  // expected answer, partial-credit guidance, structured expectation and each approach's steps survive
  // (the old save replaced the whole rubric and silently dropped them).
  const current = await prisma.rubric.findUnique({
    where: { questionId },
    select: { activeVersion: { select: { criteria: true, markingCheckpoints: true, solutionApproaches: true } } },
  });
  const existingScheme = schemeOf(current?.activeVersion ?? {}, Number(question.maximumMarks));
  const merged = mergeCheckpointEdits(existingScheme.criteria, checkpoints, Number(question.maximumMarks));
  if (!merged.ok) return { error: merged.message };

  const saved = await saveSchemeVersion({
    teacherId: session.user.id,
    questionId,
    changes: {
      solutionApproaches: mergeApproachEdits(parseStoredApproaches(current?.activeVersion?.solutionApproaches), approaches),
      markingCheckpoints: merged.criteria.map((c) => ({ description: c.description, marks: c.marks })),
      criteria: merged.criteria,
    },
  });
  if (!saved.ok) return { error: saved.message };

  // A scheme the teacher changed applies to answers already drafted (decision D13).
  after(() => reapplyAfterSchemeChange(questionId, session.user.id));

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

function parseStoredApproaches(raw: unknown): StoredApproach[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      description: typeof item.description === "string" ? item.description : "",
      steps: Array.isArray(item.steps) ? item.steps.filter((s): s is string => typeof s === "string") : [],
      isPrimary: item.isPrimary === true,
    }));
}

/**
 * Approves one question's marking scheme (decision D8): the AI drafted it, a teacher checked it. Answers
 * parked because the scheme was not approved are picked up and marked straight away.
 */
export async function approveSchemeAction(questionId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireTeacherSession();
  const result = await approveScheme({ teacherId: session.user.id, questionId });
  if (!result.ok) return { error: result.message };

  if (!result.alreadyApproved) after(() => reapplyAfterSchemeChange(questionId, session.user.id));
  const question = await getOwnedQuestion(questionId, session.user.id);
  if (question) {
    revalidatePath(`/teacher/assessments/${question.assessmentId}`);
    revalidatePath(`/teacher/assessments/${question.assessmentId}/rubrics`);
  }
  return { success: true };
}

/** Approves every question's scheme at once; one that cannot be approved is reported, never skipped silently. */
export async function approveAllSchemesAction(assessmentId: string, _prev: ActionState): Promise<ActionState> {
  const session = await requireTeacherSession();
  const result = await approveAllSchemes({ teacherId: session.user.id, assessmentId });
  if (!result) return { error: "Assessment not found." };

  for (const questionId of result.newlyApprovedQuestionIds) {
    after(() => reapplyAfterSchemeChange(questionId, session.user.id));
  }
  revalidatePath(`/teacher/assessments/${assessmentId}`);
  revalidatePath(`/teacher/assessments/${assessmentId}/rubrics`);

  if (result.skipped.length > 0) {
    const detail = result.skipped.map((s) => `Question ${s.questionNumber}: ${s.message}`).join(" ");
    return { error: `Approved ${result.approved}. Not approved — ${detail}` };
  }
  return { success: true };
}

/** Sets the follow-through and no-working rules for one question. Saved as a new version, so it applies to answers already drafted. */
export async function saveSchemeRulesAction(
  questionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();
  // The form shows only the settings that apply to this kind of question; a setting it did not show is left as it was.
  const followThrough = formData.get("followThrough") === null ? null : String(formData.get("followThrough"));
  const noWorkingRule = formData.get("noWorkingRule") === null ? null : String(formData.get("noWorkingRule"));
  if (followThrough !== null && !(FOLLOW_THROUGH_RULES as readonly string[]).includes(followThrough)) return { error: "Choose a follow-through rule." };
  if (noWorkingRule !== null && !(NO_WORKING_RULES as readonly string[]).includes(noWorkingRule)) return { error: "Choose what a correct answer with no working earns." };
  const formatsShown = formData.get("formatsShown") === "1";

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) return { error: "Question not found." };

  const saved = await saveSchemeVersion({
    teacherId: session.user.id,
    questionId,
    changes: {
      ...(followThrough !== null ? { followThrough: followThrough as never } : {}),
      ...(noWorkingRule !== null ? { noWorkingRule: noWorkingRule as never } : {}),
      ...(formatsShown ? { acceptPercent: formData.get("acceptPercent") === "on", decimalComma: formData.get("decimalComma") === "on" } : {}),
    },
  });
  if (!saved.ok) return { error: saved.message };

  after(() => reapplyAfterSchemeChange(questionId, session.user.id));
  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

/**
 * Manually retries automatic rubric generation for one question — the
 * teacher-facing retry mechanism for a FAILED generation (Phase 4.1 Step 6).
 * Also covers two edge cases with the same one action, both via the same
 * upsert: a question whose Rubric row is stuck PENDING (e.g. the server
 * restarted before its background task ran) and — for full backward
 * compatibility — a genuinely old Question row created before this phase
 * existed, which has no Rubric row at all yet. Idempotent: if generation is
 * already GENERATING or already READY, the underlying atomic claim in
 * generateRubricForQuestion simply matches nothing and this is a no-op.
 */
export async function retryRubricGeneration(
  questionId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const question = await getOwnedQuestion(questionId, session.user.id);
  if (!question) {
    return { error: "Question not found." };
  }

  await prisma.rubric.upsert({
    where: { questionId },
    create: { questionId },
    update: {},
  });

  // Backgrounded, not awaited here, mirroring evaluateHandwrittenSubmission's
  // trigger (Phase 3.4C): the atomic PENDING/FAILED -> GENERATING claim lives
  // inside generateRubricForQuestion itself, so this action can return
  // immediately and the assessment page's auto-refresh picks up the result
  // rather than holding the request open for the AI call's duration.
  after(async () => {
    await generateRubricForQuestion(questionId);
  });

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
  return { success: true };
}

/**
 * Phase 4.3 — the primary, assessment-level rubric generation trigger: one
 * button the teacher clicks once every question exists ("Generate All
 * Rubrics"), instead of triggering generation automatically per question.
 * This is also the "Retry Failed Rubrics" action — the same call naturally
 * only re-attempts FAILED (and any still-PENDING/missing) questions on a
 * second click, since generateAllRubricsForAssessment always excludes
 * already-READY and currently-GENERATING ones; the UI just changes the
 * button's label depending on which case applies (see
 * RubricGenerationActions.tsx).
 *
 * Restricted to DRAFT: once an assessment is PUBLISHED, students may already
 * be submitting against its rubrics, so bulk-(re)generating them here is out
 * of scope for this action — a published assessment's rubrics are expected
 * to already be complete (publishAssessment guarantees that at the moment
 * of publishing).
 */
export async function generateAllRubrics(
  assessmentId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId: session.user.id },
    select: { status: true },
  });
  if (!assessment) {
    return { error: "Assessment not found." };
  }
  if (assessment.status !== "DRAFT") {
    return { error: `Assessment is already ${assessment.status.toLowerCase()} — rubrics can no longer be bulk-generated.` };
  }

  const questionCount = await prisma.question.count({ where: { assessmentId } });
  if (questionCount === 0) {
    return { error: "Add at least one question before generating rubrics." };
  }

  // Backgrounded for the same reason as retryRubricGeneration: this could
  // involve many AI calls (one per question still needing generation), so
  // the request returns immediately and the assessment page's watcher polls
  // for the result rather than holding the connection open.
  after(async () => {
    await generateAllRubricsForAssessment(assessmentId);
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  revalidatePath(`/teacher/assessments/${assessmentId}/rubrics`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Publishing is the point of no return for "is this assessment's evaluation
 * intelligence complete" — a student can submit against a published
 * assessment immediately, so this must never trust anything the page
 * happened to render earlier. getAssessmentReadiness re-fetches Question +
 * Rubric state fresh from the database on every call (Phase 4.2), so a
 * rubric that finished generating (or failed) after the teacher's page
 * loaded is still caught correctly here — the authoritative check, not
 * just the disabled state on the button that got them here.
 */
export async function publishAssessment(
  assessmentId: string,
  _prevState: ActionState,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, teacherId: session.user.id },
    select: { status: true },
  });
  if (!assessment) {
    return { error: "Assessment not found." };
  }
  if (assessment.status !== "DRAFT") {
    return { error: `Assessment is already ${assessment.status.toLowerCase()}.` };
  }

  const readiness = await getAssessmentReadiness(assessmentId);
  if (!readiness.isReady) {
    return { error: describeAssessmentReadiness(readiness).message };
  }

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: { status: "PUBLISHED" },
  });

  revalidatePath(`/teacher/assessments/${assessmentId}`);
  revalidatePath("/teacher/assessments");
  revalidatePath("/teacher/dashboard");
  return { success: true };
}
