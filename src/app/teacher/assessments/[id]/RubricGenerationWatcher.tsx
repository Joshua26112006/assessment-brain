"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server (via a soft refresh) while any question's rubric is
 * still PENDING/GENERATING, so the teacher sees "Rubrics ready for review"
 * appear on its own rather than needing to manually reload — the same
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
