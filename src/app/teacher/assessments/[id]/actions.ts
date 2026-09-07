"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTeacherSession } from "@/lib/require-teacher";
import { generateRubricForQuestion, generateAllRubricsForAssessment } from "@/lib/rubricGeneration";
import { getAssessmentReadiness, describeAssessmentReadiness } from "@/lib/assessment/readiness";

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
      data: { questionText, maximumMarks, questionNumber },
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

  revalidatePath(`/teacher/assessments/${question.assessmentId}`);
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

  await prisma.$transaction(async (tx) => {
    let rubric = await tx.rubric.findUnique({
      where: { questionId },
      include: { activeVersion: true },
    });

    if (!rubric) {
      rubric = await tx.rubric.create({
        data: { questionId },
        include: { activeVersion: true },
      });
    }

    const highestVersion = await tx.rubricVersion.aggregate({
      where: { rubricId: rubric.id },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (highestVersion._max.versionNumber ?? 0) + 1;

    const newVersion = await tx.rubricVersion.create({
      data: {
        rubricId: rubric.id,
        versionNumber: nextVersionNumber,
        status: "ACTIVE",
        solutionApproaches: approaches,
        markingCheckpoints: checkpoints,
      },
    });

    if (rubric.activeVersionId) {
      await tx.rubricVersion.update({
        where: { id: rubric.activeVersionId },
        data: { status: "SUPERSEDED" },
      });
    }

    await tx.rubric.update({
      where: { id: rubric.id },
      data: { activeVersionId: newVersion.id, generationStatus: "READY", generationError: null },
    });
  });

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
