"use server";

import { revalidatePath } from "next/cache";
import { requireTeacherSession } from "@/lib/require-teacher";
import { resolveReviewItem, type ReviewResolutionAction } from "@/lib/assessment/reviewResolution";

export type ActionState = { error?: string; success?: boolean };

const MAX_FEEDBACK_LENGTH = 2000;

const DECISION_BY_FORM_VALUE: Record<string, ReviewResolutionAction> = {
  confirm: "CONFIRM",
  override: "OVERRIDE",
  dismiss: "DISMISS",
};

/**
 * Applies a teacher's decision on one review item.
 *
 * Identity comes from the session only — the form carries no teacher,
 * student, assessment or submission id, and the review item id it does
 * carry is re-checked against this teacher's own assessments inside
 * resolveReviewItem before anything is written. A forged review item id
 * therefore fails ownership rather than resolving someone else's item.
 */
export async function submitReviewDecision(
  reviewItemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTeacherSession();

  const decisionRaw = String(formData.get("decision") ?? "");
  const action = DECISION_BY_FORM_VALUE[decisionRaw];
  if (!action) {
    return { error: "Choose confirm, override, or dismiss." };
  }

  const feedbackNote = String(formData.get("feedbackNote") ?? "").trim();
  if (feedbackNote.length > MAX_FEEDBACK_LENGTH) {
    return { error: `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer.` };
  }

  let overrideMarks: number | null = null;
  if (action === "OVERRIDE") {
    const marksRaw = String(formData.get("overrideMarks") ?? "").trim();
    if (!marksRaw) {
      return { error: "Enter the marks to award." };
    }
    const parsed = Number(marksRaw);
    if (!Number.isFinite(parsed)) {
      return { error: "Marks must be a valid number." };
    }
    // Range is checked authoritatively against the question's own maximum
    // inside resolveReviewItem, which is the only place that can see it.
    overrideMarks = parsed;
  }

  const result = await resolveReviewItem({
    reviewItemId,
    teacherId: session.user.id,
    action,
    overrideMarks,
    feedbackNote: feedbackNote || null,
  });

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/teacher/review-queue");
  revalidatePath(`/teacher/review-queue/${reviewItemId}`);
  if (result.submissionId) {
    revalidatePath(`/student/results/${result.submissionId}`);
  }

  return { success: true };
}
