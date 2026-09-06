import PageSkeleton from "@/components/PageSkeleton";

/**
 * Safe to stream: this route has no child segments, so no notFound() below it
 * can be forced into a 200 by the shell being flushed early. Detail routes
 * that call notFound() deliberately have no loading.tsx for that reason.
 */
export default function Loading() {
  return <PageSkeleton rows={2} />;
}
