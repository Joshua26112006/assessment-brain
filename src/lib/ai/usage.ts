import { prisma } from "@/lib/prisma";

export interface AiUsageBreakdownRow {
  key: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface AiUsageSummary {
  totalCostUsd: number;
  totalCallCount: number;
  byStage: AiUsageBreakdownRow[];
  byModel: AiUsageBreakdownRow[];
}

/** Aggregate AiCallLog spend, grouped by stage and by model, highest cost first. */
export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const [byStage, byModel] = await Promise.all([
    prisma.aiCallLog.groupBy({
      by: ["stage"],
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }),
    prisma.aiCallLog.groupBy({
      by: ["model"],
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }),
  ]);

  const toRow = (key: string, group: (typeof byStage)[number] | (typeof byModel)[number]): AiUsageBreakdownRow => ({
    key,
    callCount: group._count._all,
    promptTokens: group._sum.promptTokens ?? 0,
    completionTokens: group._sum.completionTokens ?? 0,
    costUsd: Number(group._sum.costUsd ?? 0),
  });

  const stageRows = byStage.map((g) => toRow(g.stage, g)).sort((a, b) => b.costUsd - a.costUsd);
  const modelRows = byModel.map((g) => toRow(g.model, g)).sort((a, b) => b.costUsd - a.costUsd);

  const totalCostUsd = stageRows.reduce((sum, r) => sum + r.costUsd, 0);
  const totalCallCount = stageRows.reduce((sum, r) => sum + r.callCount, 0);

  return { totalCostUsd, totalCallCount, byStage: stageRows, byModel: modelRows };
}
