import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

function parseMonth(month?: string): { year: number; month: number } | null {
  if (!month) return null;
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(mon) || mon < 1 || mon > 12) return null;
  return { year, month: mon };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(params: { workspaceId: string; month?: string }) {
    const parsed = parseMonth(params.month);
    if (!parsed) throw new BadRequestException("month query param is required in format YYYY-MM");

    const ws = await this.prisma.workspace.findUnique({ where: { id: params.workspaceId } });
    if (!ws) throw new BadRequestException("workspace not found");

    const rollup = await this.prisma.analyticsMonthlyRollup.findUnique({
      where: {
        workspaceId_year_month_currency: {
          workspaceId: params.workspaceId,
          year: parsed.year,
          month: parsed.month,
          currency: ws.currency,
        },
      },
    });

    if (rollup) {
      return {
        month: params.month,
        currency: rollup.currency,
        totalCents: rollup.totalCents,
        byCategory: rollup.byCategory ?? {},
        byMerchant: rollup.byMerchant ?? {},
      };
    }

    const from = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
    const to = new Date(Date.UTC(parsed.year, parsed.month, 1));

    const txns = await this.prisma.transaction.findMany({
      where: {
        workspaceId: params.workspaceId,
        deletedAt: null,
        currency: ws.currency,
        occurredAt: { gte: from, lt: to },
      },
      include: { merchant: { select: { name: true } }, category: { select: { name: true } } },
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

    return { month: params.month, currency: ws.currency, totalCents, byCategory, byMerchant };
  }
}

