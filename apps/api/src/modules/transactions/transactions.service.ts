import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TransactionSource } from "@famfinance/db";
import { PrismaService } from "../../prisma/prisma.service";

function normalizeMerchant(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTransactions(params: {
    workspaceId: string;
    from?: string;
    to?: string;
    categoryId?: string;
    merchantId?: string;
    source?: TransactionSource;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const from = params.from ? new Date(params.from) : undefined;
    const to = params.to ? new Date(params.to) : undefined;

    const occurredAt =
      from || to
        ? {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          }
        : undefined;

    const txns = await this.prisma.transaction.findMany({
      where: {
        workspaceId: params.workspaceId,
        deletedAt: null,
        ...(occurredAt ? { occurredAt } : {}),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
        ...(params.merchantId ? { merchantId: params.merchantId } : {}),
        ...(params.source ? { source: params.source } : {}),
      },
      include: {
        merchant: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: offset,
      take: limit,
    });

    return txns.map((t) => this.toApiTransaction(t));
  }

  async createManualTransaction(params: {
    workspaceId: string;
    occurredAt: string;
    amountCents: number;
    currency?: string;
    description?: string;
    merchantName?: string;
    categoryName?: string;
  }) {
    const occurredAt = new Date(params.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException("Invalid occurredAt");

    const merchantName = params.merchantName?.trim() || undefined;
    const categoryName = params.categoryName?.trim() || undefined;

    const merchant = merchantName
      ? await this.prisma.merchant.upsert({
          where: {
            workspaceId_normalized: {
              workspaceId: params.workspaceId,
              normalized: normalizeMerchant(merchantName),
            },
          },
          update: { name: merchantName },
          create: {
            workspaceId: params.workspaceId,
            name: merchantName,
            normalized: normalizeMerchant(merchantName),
          },
        })
      : null;

    const category = categoryName
      ? await this.prisma.category.upsert({
          where: {
            workspaceId_name: {
              workspaceId: params.workspaceId,
              name: categoryName,
            },
          },
          update: {},
          create: { workspaceId: params.workspaceId, name: categoryName },
        })
      : null;

    const created = await this.prisma.transaction.create({
      data: {
        workspaceId: params.workspaceId,
        source: TransactionSource.MANUAL,
        occurredAt,
        amountCents: params.amountCents,
        currency: params.currency || "EUR",
        description: params.description ?? null,
        merchantId: merchant?.id ?? null,
        categoryId: category?.id ?? null,
      },
      include: {
        merchant: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });

    return this.toApiTransaction(created);
  }

  async updateTransaction(params: {
    workspaceId: string;
    transactionId: string;
    merchantId?: string | null;
    categoryId?: string | null;
    description?: string | null;
  }) {
    const existing = await this.prisma.transaction.findFirst({
      where: { id: params.transactionId, workspaceId: params.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException("Transaction not found");

    if (typeof params.merchantId === "string") {
      const merchant = await this.prisma.merchant.findFirst({
        where: { id: params.merchantId, workspaceId: params.workspaceId },
      });
      if (!merchant) throw new NotFoundException("Merchant not found");
    }

    if (typeof params.categoryId === "string") {
      const category = await this.prisma.category.findFirst({
        where: { id: params.categoryId, workspaceId: params.workspaceId },
      });
      if (!category) throw new NotFoundException("Category not found");
    }

    const updated = await this.prisma.transaction.update({
      where: { id: existing.id },
      data: {
        merchantId: params.merchantId === undefined ? undefined : params.merchantId,
        categoryId: params.categoryId === undefined ? undefined : params.categoryId,
        description: params.description === undefined ? undefined : params.description,
      },
      include: {
        merchant: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });

    return this.toApiTransaction(updated);
  }

  async softDelete(params: { workspaceId: string; transactionId: string }) {
    const existing = await this.prisma.transaction.findFirst({
      where: { id: params.transactionId, workspaceId: params.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException("Transaction not found");

    await this.prisma.transaction.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  private toApiTransaction(t: {
    id: string;
    occurredAt: Date;
    amountCents: number;
    currency: string;
    description: string | null;
    merchant?: { id: string; name: string } | null;
    category?: { id: string; name: string } | null;
    source: TransactionSource;
    documentId: string | null;
    extractionId: string | null;
  }) {
    return {
      transactionId: t.id,
      occurredAt: t.occurredAt,
      amountCents: t.amountCents,
      currency: t.currency,
      description: t.description,
      merchant: t.merchant ? { merchantId: t.merchant.id, name: t.merchant.name } : null,
      category: t.category ? { categoryId: t.category.id, name: t.category.name } : null,
      source: t.source,
      documentId: t.documentId,
      extractionId: t.extractionId,
    };
  }
}
