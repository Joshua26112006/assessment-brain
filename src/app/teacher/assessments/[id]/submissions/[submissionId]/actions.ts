"use server";

import { revalidatePath } from "next/cache";
import { requireTeacherSession } from "@/lib/require-teacher";
import {
  acceptAllSure,
  acceptDraft,
  changeMark,
  confirmSubmission,
  releaseSubmission,
  reopenSubmission,
  setComment,
  type MarkActionFailure,
} from "@/lib/assessment/markRelease";

export type ActionState = { error?: string; blockers?: string[]; success?: string };

const MAX_NOTE_LENGTH = 2000;
const MAX_REASON_LENGTH = 1000;

/**
 * Identity comes from the session only. The forms carry a response or
 * submission id, and every domain function re-checks that it belongs to an
 * assessment this teacher owns before reading or writing anything — so a
 * forged id fails as "not found" rather than reaching someone else's marks.
 */

function refresh(submissionId: string) {
  revalidatePath("/teacher/assessments/[id]/submissions/[submissionId]", "page");
  revalidatePath("/teacher/assessments/[id]/submissions", "page");
  // The student's own pages change the moment a submission is released or taken back.
  revalidatePath(`/student/results/${submissionId}`);
  revalidatePath("/student/results");
  revalidatePath("/student/dashboard");
}

function failure(result: MarkActionFailure): ActionState {
  return { error: result.message, blockers: result.blockers };
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Accept, change or comment on one answer. */
export async function submitAnswerDecision(
  submissionId: string,
  responseId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;
  const decision = text(formData, "decision");

  const note = text(formData, "note");
  if (note.length > MAX_NOTE_LENGTH) {
    return { error: `The comment must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }
  const reason = text(formData, "reason");
  if (reason.length > MAX_REASON_LENGTH) {
    return { error: `The reason must be ${MAX_REASON_LENGTH} characters or fewer.` };
  }

  if (decision === "accept") {
    const result = await acceptDraft({ teacherId, responseId });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return { success: result.changed ? "Mark accepted." : "Already accepted." };
  }

  if (decision === "change") {
    const marksRaw = text(formData, "marks");
    if (!marksRaw) return { error: "Enter the marks to award." };
    // The range and the half-mark step are checked authoritatively, against the
    // question's own maximum, inside changeMark.
    const result = await changeMark({
      teacherId,
      responseId,
      marks: Number(marksRaw),
      reason: reason || null,
      note: note || null,
    });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return { success: "Mark saved." };
  }

  if (decision === "comment") {
    const result = await setComment({ teacherId, responseId, note });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return { success: note ? "Comment saved." : "Comment removed." };
  }

  return { error: "Choose accept, change or comment." };
}

/** Accept all sure answers, confirm, release or reopen a whole submission. */
export async function submitSubmissionDecision(
  submissionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();
  const teacherId = session.user.id;
  const decision = text(formData, "decision");

  if (decision === "acceptAll") {
    const result = await acceptAllSure({ teacherId, submissionId });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return {
      success:
        result.accepted === 0
          ? "There were no sure answers left to accept."
          : `Accepted ${result.accepted} answer${result.accepted === 1 ? "" : "s"}.` +
            (result.skipped > 0 ? ` ${result.skipped} still need your attention.` : ""),
    };
  }

  if (decision === "confirm") {
    const result = await confirmSubmission({ teacherId, submissionId });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return {
      success: result.alreadyConfirmed
        ? "Already confirmed."
        : `Marks confirmed: ${result.awardedMarks} / ${result.maximumMarks}.`,
    };
  }

  if (decision === "release") {
    const result = await releaseSubmission({ teacherId, submissionId });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return { success: result.alreadyReleased ? "Already released." : "Released. The student can now see their marks." };
  }

  if (decision === "reopen") {
    const reason = text(formData, "reason");
    if (reason.length > MAX_REASON_LENGTH) {
      return { error: `The reason must be ${MAX_REASON_LENGTH} characters or fewer.` };
    }
    const result = await reopenSubmission({ teacherId, submissionId, reason: reason || null });
    if (!result.ok) return failure(result);
    refresh(submissionId);
    return { success: "Reopened. The student can no longer see these marks until you release them again." };
  }

  return { error: "Choose an action." };
}
