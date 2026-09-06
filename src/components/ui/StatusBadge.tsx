/**
 * The single status vocabulary for Assessment Brain.
 *
 * Every surface that shows "where has this got to" — dashboards, queues,
 * results, the review workspace — resolves its wording and colour here, so a
 * response that needs review looks and reads the same to a teacher on the
 * queue as it does on the submissions view.
 *
 * Two rules this file exists to enforce:
 *   1. Colour never carries meaning alone — every badge has a text label.
 *   2. Students and teachers get different wording for the same underlying
 *      state. A student should read "Awaiting teacher check", never
 *      "UNCERTAIN_CORRECTION".
 */

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "novel";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-muted text-muted",
  info: "border-info-line bg-info-soft text-info",
  success: "border-success-line bg-success-soft text-success",
  warning: "border-warning-line bg-warning-soft text-warning",
  danger: "border-danger-line bg-danger-soft text-danger",
  accent: "border-accent-soft bg-accent-soft text-accent-text",
  novel: "border-novel-line bg-novel-soft text-novel",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-subtle",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
  novel: "bg-novel",
};

export interface BadgeDescriptor {
  label: string;
  tone: BadgeTone;
}

export default function StatusBadge({
  label,
  tone = "neutral",
  title,
  size = "md",
}: {
  label: string;
  tone?: BadgeTone;
  /** Optional plain-language explanation surfaced on hover/focus. */
  title?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium ${
        TONE_CLASSES[tone]
      } ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Domain → badge mappings
// ---------------------------------------------------------------------------

/** QuestionResponse.status, worded for whoever is reading it. */
export function questionResponseBadge(
  status: string,
  audience: "teacher" | "student" = "teacher",
): BadgeDescriptor {
  switch (status) {
    case "GRADED":
      return { label: audience === "student" ? "Marked" : "Graded", tone: "success" };
    case "NEEDS_REVIEW":
      return {
        label: audience === "student" ? "Awaiting teacher check" : "Needs review",
        tone: "warning",
      };
    case "FAILED":
      return { label: "Evaluation failed", tone: "danger" };
    case "PENDING":
      return { label: audience === "student" ? "Not evaluated yet" : "Queued", tone: "neutral" };
    default:
      // Every intermediate pipeline state (CORRECTING, GRADING, ...) reads the
      // same to a user: work is in flight.
      return { label: "Evaluating", tone: "info" };
  }
}

/** Submission.status. */
export function submissionBadge(
  status: string,
  audience: "teacher" | "student" = "teacher",
): BadgeDescriptor {
  switch (status) {
    case "DRAFT":
      return {
        label: audience === "student" ? "In progress" : "Not submitted",
        tone: "neutral",
      };
    case "SUBMITTED":
      return { label: "Submitted", tone: "info" };
    case "PROCESSING":
      return { label: "Evaluating", tone: "info" };
    case "COMPLETED":
      return { label: "Complete", tone: "success" };
    case "NEEDS_REVIEW":
      return {
        label: audience === "student" ? "Awaiting teacher check" : "Needs review",
        tone: "warning",
      };
    case "FAILED":
      return { label: "Evaluation failed", tone: "danger" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Rubric.generationStatus (Phase 4.1) — AI rubric generation, per question. */
export function rubricGenerationBadge(status: string): BadgeDescriptor {
  switch (status) {
    case "READY":
      return { label: "AI-Generated Rubric", tone: "accent" };
    case "GENERATING":
      return { label: "Generating rubric…", tone: "info" };
    case "FAILED":
      return { label: "Rubric generation failed", tone: "danger" };
    case "PENDING":
    default:
      return { label: "Rubric queued", tone: "neutral" };
  }
}

/** Assessment.status — draft and published must be distinguishable at a glance. */
export function assessmentBadge(status: string): BadgeDescriptor {
  switch (status) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    case "PUBLISHED":
      return { label: "Published", tone: "success" };
    case "CLOSED":
      return { label: "Closed", tone: "neutral" };
    case "RESULTS_AVAILABLE":
      return { label: "Results available", tone: "success" };
    case "PROCESSING":
      return { label: "Processing", tone: "info" };
    default:
      return { label: status.replaceAll("_", " ").toLowerCase(), tone: "neutral" };
  }
}

/** ReviewItem.status. */
export function reviewItemBadge(status: string): BadgeDescriptor {
  switch (status) {
    case "PENDING":
      return { label: "Open", tone: "warning" };
    case "IN_REVIEW":
      return { label: "In review", tone: "info" };
    case "RESOLVED":
      return { label: "Resolved", tone: "success" };
    case "DISMISSED":
      return { label: "Dismissed", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Why the pipeline asked for a human — teacher-facing. */
export function reviewReasonBadge(reason: string): BadgeDescriptor {
  switch (reason) {
    case "NOVEL_APPROACH":
      return { label: "Possible new approach", tone: "novel" };
    case "VERIFICATION_FAILURE":
      return { label: "Evaluation failed", tone: "danger" };
    case "UNCERTAIN_CORRECTION":
      return { label: "Uncertain marking", tone: "warning" };
    case "AMBIGUOUS_EXTRACTION":
      return { label: "Hard to read", tone: "warning" };
    case "AMBIGUOUS_ANNOTATION":
      return { label: "Uncertain feedback", tone: "warning" };
    case "UNDETERMINED_GRADING":
      return { label: "No mark determined", tone: "warning" };
    case "INVALID_ANSWER_SHEET":
      return { label: "Not a valid answer sheet", tone: "danger" };
    default:
      return { label: "Flagged", tone: "neutral" };
  }
}

/** A fuller sentence explaining the flag, for the queue and workspace. */
export const REVIEW_REASON_DESCRIPTION: Record<string, string> = {
  NOVEL_APPROACH: "The answer may use a valid approach the rubric doesn't cover.",
  AMBIGUOUS_EXTRACTION: "The answer was hard to read or extract.",
  UNCERTAIN_CORRECTION: "The evaluation was uncertain and needs your confirmation.",
  VERIFICATION_FAILURE: "Evaluation could not be completed for this response.",
  AMBIGUOUS_ANNOTATION: "Feedback generation was uncertain.",
  UNDETERMINED_GRADING: "A mark could not be determined automatically.",
  INVALID_ANSWER_SHEET: "The uploaded pages don't look like a usable answer sheet for this assessment.",
  OTHER: "Flagged for your review.",
};

/**
 * Where a mark came from. Deliberately says nothing about which model or
 * provider produced it — that's implementation detail, not evidence.
 */
export function evidenceSourceBadge(source: string | undefined): BadgeDescriptor | null {
  switch (source) {
    case "TEACHER_REVIEWED":
      return { label: "Teacher checked", tone: "success" };
    case "AI_VERIFIED":
      return { label: "AI verified", tone: "accent" };
    case "DETERMINISTIC":
      return { label: "Rubric matched", tone: "neutral" };
    default:
      return null;
  }
}

export const EVIDENCE_SOURCE_DESCRIPTION: Record<string, string> = {
  TEACHER_REVIEWED: "A teacher confirmed or set this mark.",
  AI_VERIFIED: "Checkpoints were re-checked after the two evaluations disagreed.",
  DETERMINISTIC: "Marked by matching the answer against the rubric's checkpoints.",
};
