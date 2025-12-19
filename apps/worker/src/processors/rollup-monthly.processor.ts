import type { PrismaClient } from "@famfinance/db";

export type RollupMonthlyPayload = {
  workspaceId: string;
  year: number;
  month: number;
  currency: string;
};

export async function processRollupMonthly(params: { prisma: PrismaClient; payload: RollupMonthlyPayload }) {
  const { prisma, payload } = params;
  const from = new Date(Date.UTC(payload.year, payload.month - 1, 1));
  const to = new Date(Date.UTC(payload.year, payload.month, 1));

  const txns = await prisma.transaction.findMany({
    where: {
      workspaceId: payload.workspaceId,
      currency: payload.currency,
      deletedAt: null,
      occurredAt: { gte: from, lt: to },
    },
    include: {
      merchant: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  let totalCents = 0;
  const byMerchant: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const t of txns) {
    totalCents += t.amountCents;
    const merchant = t.merchant?.name ?? "Unknown";
    const category = t.category?.name ?? "Uncategorized";
    byMerchant[merchant] = (byMerchant[merchant] ?? 0) + t.amountCents;
    byCategory[category] = (byCategory[category] ?? 0) + t.amountCents;
  }

  await prisma.analyticsMonthlyRollup.upsert({
    where: {
      workspaceId_year_month_currency: {
        workspaceId: payload.workspaceId,
        year: payload.year,
        month: payload.month,
        currency: payload.currency,
      },
    },
    update: { totalCents, byMerchant, byCategory },
    create: {
      workspaceId: payload.workspaceId,
      year: payload.year,
      month: payload.month,
      currency: payload.currency,
      totalCents,
      byMerchant,
      byCategory,
    },
  });

  return { status: "rolled_up", totalCents };
}

