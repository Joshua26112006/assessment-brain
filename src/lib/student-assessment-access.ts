import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * An assessment is "available" to students once published. The
 * AssessmentStatus enum has later pipeline states (PROCESSING,
 * RESULTS_AVAILABLE, CLOSED, ...) that don't exist yet in this app's
 * current capabilities, so PUBLISHED is the only gate implemented here —
 * not because other states are ignored, but because nothing currently
 * transitions an assessment past PUBLISHED.
 */
const AVAILABLE_STATUS = "PUBLISHED";

/**
 * A student is eligible for an assessment iff they have a ClassMembership
 * row for the assessment's class — never inferred any other way.
 */
async function isStudentEligible(assessmentClassId: string, studentId: string) {
  const membership = await prisma.classMembership.findUnique({
    where: { classId_studentId: { classId: assessmentClassId, studentId } },
    select: { id: true },
  });
  return membership !== null;
}

/**
 * Fetches every assessment currently available to this student: published,
 * and the student is a member of its class. Also attaches (if present) the
 * student's own submission for each, so the list can show its status.
 */
export async function getAvailableAssessmentsForStudent(studentId: string) {
  const assessments = await prisma.assessment.findMany({
    where: {
      status: AVAILABLE_STATUS,
      class: { memberships: { some: { studentId } } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { questions: true } },
      submissions: { where: { studentId }, select: { id: true, status: true } },
    },
  });

  return assessments.map((a) => ({
    ...a,
    submission: a.submissions[0] ?? null,
  }));
}

/**
 * Loads one assessment for a student, enforcing BOTH that it's published
 * and that the student is eligible (class membership) — never trusting the
 * URL alone. Uses notFound() (not a "forbidden" page) so an ineligible or
 * unpublished assessment ID is indistinguishable from a nonexistent one.
 */
export async function getEligibleAssessmentOrNotFound(
  assessmentId: string,
  studentId: string,
) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, status: AVAILABLE_STATUS },
    include: {
      questions: { orderBy: { questionNumber: "asc" } },
      class: { select: { id: true, name: true } },
    },
  });

  if (!assessment) {
    notFound();
  }

  const eligible = await isStudentEligible(assessment.classId, studentId);
  if (!eligible) {
    notFound();
  }

  return assessment;
}

/**
 * Finds this student's existing submission for the assessment, or creates a
 * new DRAFT one. The schema's own unique constraint on
 * (assessmentId, studentId) makes this safe against duplicates even under
 * a race — the create would fail with P2002 if one slipped in between the
 * find and the create, which is handled by re-fetching rather than erroring.
 */
export async function getOrCreateSubmission(assessmentId: string, studentId: string) {
  const existing = await prisma.submission.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId } },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.submission.create({
      data: { assessmentId, studentId },
    });
  } catch {
    // Lost a create race — the unique constraint guarantees one now exists.
    const nowExists = await prisma.submission.findUnique({
      where: { assessmentId_studentId: { assessmentId, studentId } },
    });
    if (!nowExists) throw new Error("Failed to create or find submission.");
    return nowExists;
  }
}

/**
 * Loads a submission scoped to the authenticated student, with its
 * assessment (and questions) and existing answers. notFound() if it
 * doesn't exist or belongs to someone else — a student can never reach
 * another student's submission by guessing/changing the URL.
 */
export async function getOwnedSubmissionOrNotFound(
  submissionId: string,
  studentId: string,
) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, studentId },
    include: {
      assessment: {
        include: { questions: { orderBy: { questionNumber: "asc" } } },
      },
      questionResponses: true,
    },
  });

  if (!submission) {
    notFound();
  }

  return submission;
}
