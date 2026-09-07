"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server (via a soft refresh) while `active` — the caller decides
 * what that means; both current call sites (the assessment detail page and
 * the consolidated rubric page) pass `readiness.generatingCount > 0`, i.e.
 * generation actually in flight right now, deliberately NOT merely PENDING
 * (Phase 4.3: generation is teacher-triggered via "Generate All Rubrics",
 * not automatic, so a PENDING question can sit unchanged indefinitely —
 * polling for that alone would be wasted requests). Mirrors the same
 * pattern QuestionPaperReview.tsx already uses while extraction is running.
 * Renders nothing; this is pure background behavior.
 */
export default function RubricGenerationWatcher({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(interval);
  }, [active, router]);

  return null;
}
