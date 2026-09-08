import { NextResponse } from "next/server";
import { requireTeacherApiSession } from "@/lib/api-session";
import { getAiUsageSummary } from "@/lib/ai/usage";

/**
 * Aggregate OpenRouter spend (AiCallLog), grouped by stage and by model.
 * Platform-wide, not scoped to the requesting teacher's own assessments —
 * AiCallLog carries no teacherId (an AI call isn't owned by one teacher the
 * way an Assessment is), so this is an ops/cost-visibility view any signed-in
 * teacher can read, not a per-tenant data endpoint.
 */
export async function GET() {
  const session = await requireTeacherApiSession();
  if (!session.ok) return session.response;

  const summary = await getAiUsageSummary();
  return NextResponse.json(summary);
}
