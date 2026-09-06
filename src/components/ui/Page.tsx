import Link from "next/link";
import type { ReactNode } from "react";
import { cardClass } from "./styles";

/**
 * Layout primitives shared by every page: a consistent header (where am I,
 * what is this, what can I do here), a section container, a metric tile, and
 * an empty state. Kept to one small file on purpose — this is a house style,
 * not a component library.
 */

export function Breadcrumb({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-subtle">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 && <span className="px-1.5">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-muted">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  /** Primary/secondary actions, right-aligned on wide screens. */
  actions?: ReactNode;
  /** Badges or small facts shown directly under the title. */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="mb-2">
          <Breadcrumb items={breadcrumb} />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A bordered panel. `padded` off when the child manages its own spacing (e.g. lists). */
export function Card({
  children,
  className = "",
  padded = true,
  tone,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  tone?: "default" | "muted" | "warning" | "success" | "danger" | "accent";
}) {
  const toneClass =
    tone === "muted"
      ? "border-line bg-surface-muted"
      : tone === "warning"
        ? "border-warning-line bg-warning-soft"
        : tone === "success"
          ? "border-success-line bg-success-soft"
          : tone === "danger"
            ? "border-danger-line bg-danger-soft"
            : tone === "accent"
              ? "border-accent-soft bg-accent-soft"
              : cardClass;

  return (
    <div
      className={`rounded-xl border ${toneClass} ${padded ? "p-5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  href,
  emphasis = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  /** Draws attention when the number represents outstanding work. */
  emphasis?: boolean;
}) {
  const body = (
    <>
      <p
        className={`text-2xl font-semibold tabular-nums ${
          emphasis ? "text-warning" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </>
  );

  const base = `rounded-xl border p-4 ${
    emphasis ? "border-warning-line bg-warning-soft" : "border-line bg-surface"
  }`;

  return href ? (
    <Link href={href} className={`${base} block transition-colors hover:border-line-strong`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface-muted px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * A score, shown the same way everywhere. `pending` marks a total that isn't
 * final yet, so a partial score is never mistaken for a finished one.
 */
export function ScoreDisplay({
  awarded,
  maximum,
  pending = false,
  size = "md",
}: {
  awarded: number;
  maximum: number;
  pending?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const valueSize =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-xl";

  return (
    <div className="text-right">
      <p className={`${valueSize} font-semibold leading-none tabular-nums text-foreground`}>
        {awarded}
        <span className="text-subtle"> / {maximum}</span>
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
        {pending ? "So far" : "Final"}
      </p>
    </div>
  );
}
