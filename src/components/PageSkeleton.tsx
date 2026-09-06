/**
 * Placeholder shown while a server-rendered page streams in.
 *
 * Only used by route-level `loading.tsx` files on segments that have no
 * notFound()-calling descendants: a loading boundary at or above such a route
 * flushes the shell (and a 200 status) before the ownership check can throw,
 * which would turn a 404 into a 200. See the dashboards' loading.tsx.
 */
export default function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-52 animate-pulse rounded-md bg-surface-muted" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded bg-surface-muted" />

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[86px] animate-pulse rounded-xl border border-line bg-surface-muted"
          />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-line bg-surface p-5"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
            <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-surface-muted" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
