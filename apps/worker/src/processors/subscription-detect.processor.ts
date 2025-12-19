import type { PrismaClient } from "@famfinance/db";
import { SubscriptionInterval } from "@famfinance/db";

export type SubscriptionDetectPayload = {
  workspaceId: string;
};

type Candidate = {
  merchantId: string;
  merchantName: string;
  currency: string;
  amountCents: number;
  occurredAts: Date[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function guessInterval(diffsDays: number[]): SubscriptionInterval {
  const within = (target: number, tolerance: number) =>
    diffsDays.length > 0 && diffsDays.every((d) => Math.abs(d - target) <= tolerance);

  if (within(7, 2)) return SubscriptionInterval.WEEKLY;
  if (within(30, 7)) return SubscriptionInterval.MONTHLY;
  if (within(365, 30)) return SubscriptionInterval.YEARLY;
  return SubscriptionInterval.UNKNOWN;
}

function addInterval(date: Date, interval: SubscriptionInterval): Date | null {
  const d = new Date(date);
  if (interval === SubscriptionInterval.WEEKLY) {
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  if (interval === SubscriptionInterval.MONTHLY) {
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d;
  }
  if (interval === SubscriptionInterval.YEARLY) {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d;
  }
  return null;
}

export async function processSubscriptionDetect(params: {
  prisma: PrismaClient;
  payload: SubscriptionDetectPayload;
}) {
  const { prisma, payload } = params;

  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const txns = await prisma.transaction.findMany({
    where: {
      workspaceId: payload.workspaceId,
      deletedAt: null,
      occurredAt: { gte: since },
      merchantId: { not: null },
    },
    include: { merchant: { select: { id: true, name: true } } },
    orderBy: { occurredAt: "asc" },
  });

  // Group by (merchantId, currency, roundedAmountBucket)
  const groups = new Map<string, Candidate>();
  for (const t of txns) {
    if (!t.merchantId || !t.merchant) continue;
    const bucket = Math.round(t.amountCents / 50) * 50; // 50-cent buckets
    const key = `${t.merchantId}|${t.currency}|${bucket}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        merchantId: t.merchantId,
        merchantName: t.merchant.name,
        currency: t.currency,
        amountCents: bucket,
        occurredAts: [t.occurredAt],
      });
    } else {
      existing.occurredAts.push(t.occurredAt);
    }
  }

  let createdOrUpdated = 0;
  for (const g of groups.values()) {
    if (g.occurredAts.length < 3) continue;

    const dates = [...g.occurredAts].sort((a, b) => a.getTime() - b.getTime());
    const diffsDays: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      diffsDays.push(Math.round((dates[i]!.getTime() - dates[i - 1]!.getTime()) / (24 * 60 * 60 * 1000)));
    }

    const interval = guessInterval(diffsDays.slice(-2));
    if (interval === SubscriptionInterval.UNKNOWN) continue;

    const amounts = txns
      .filter((t) => t.merchantId === g.merchantId && t.currency === g.currency)
      .map((t) => t.amountCents);
    const amountCents = median(amounts);

    const lastChargedAt = dates[dates.length - 1]!;
    const nextDueAt = addInterval(lastChargedAt, interval);

    const existing = await prisma.subscription.findFirst({
      where: {
        workspaceId: payload.workspaceId,
        merchantId: g.merchantId,
        currency: g.currency,
        active: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          name: g.merchantName,
          interval,
          amountCents,
          currency: g.currency,
          lastChargedAt,
          nextDueAt,
          active: true,
        },
      });
    } else {
      await prisma.subscription.create({
        data: {
          workspaceId: payload.workspaceId,
          merchantId: g.merchantId,
          name: g.merchantName,
          interval,
          amountCents,
          currency: g.currency,
          lastChargedAt,
          nextDueAt: nextDueAt ?? undefined,
          active: true,
        },
      });
    }

    createdOrUpdated += 1;
  }

  return { status: "detected", createdOrUpdated };
}

