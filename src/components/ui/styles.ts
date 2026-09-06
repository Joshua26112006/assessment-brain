/**
 * Shared class strings for the handful of controls that appear on nearly
 * every page. Deliberately plain functions rather than styled components —
 * the app is mostly server components, and a class helper keeps buttons and
 * inputs consistent without adding a client-side runtime.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-strong text-foreground hover:bg-surface-muted",
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  danger: "border border-danger-line text-danger hover:bg-danger-soft",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return [BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra]
    .filter(Boolean)
    .join(" ");
}

/** Text inputs, selects and textareas. */
export const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-foreground " +
  "placeholder:text-subtle focus:border-accent focus:outline-none";

export const labelClass = "block text-sm font-medium text-foreground";

export const helpTextClass = "mt-1 text-xs text-subtle";

export const fieldErrorClass = "mt-1 text-xs font-medium text-danger";

/** The standard bordered container used for cards and sections. */
export const cardClass = "rounded-xl border border-line bg-surface";
