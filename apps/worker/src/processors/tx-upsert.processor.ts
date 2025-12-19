import { createHash } from "node:crypto";
import { TransactionSource } from "@famfinance/db";
import type { PrismaClient } from "@famfinance/db";

export type TxUpsertJobPayload = {
  workspaceId: string;
  documentId: string;
  extractionId: string;
  engine: string;
};

function normalizeMerchant(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function processTxUpsert(params: {
  prisma: PrismaClient;
  payload: TxUpsertJobPayload;
}) {
  const { prisma, payload } = params;
  const extraction = await prisma.extraction.findFirst({
    where: { id: payload.extractionId, workspaceId: payload.workspaceId, documentId: payload.documentId, engine: payload.engine },
  });
  if (!extraction) throw new Error("Extraction not found");

  const normalized = extraction.normalizedJson as unknown;
  if (
    !normalized ||
    typeof normalized !== "object" ||
    !("ok" in normalized) ||
    (normalized as { ok?: unknown }).ok !== true
  ) {
    return { status: "skipped_not_normalized" };
  }

  const norm = normalized as {
    ok: true;
    occurredAt: string;
    amountCents: number;
    currency?: string;
    merchantName: string;
  };

  const occurredAt = new Date(norm.occurredAt);
  const amountCents = Number(norm.amountCents);
  const currency = String(norm.currency || "EUR");
  const merchantName = String(norm.merchantName);

  if (!Number.isFinite(amountCents) || !merchantName) throw new Error("Invalid normalized payload");

  const merchantNormalized = normalizeMerchant(merchantName);
  const merchant = await prisma.merchant.upsert({
    where: { workspaceId_normalized: { workspaceId: payload.workspaceId, normalized: merchantNormalized } },
    update: { name: merchantName },
    create: { workspaceId: payload.workspaceId, name: merchantName, normalized: merchantNormalized },
  });

  const day = occurredAt.toISOString().slice(0, 10);
  const fingerprint = sha256Hex([payload.workspaceId, day, String(amountCents), merchantNormalized, currency].join("|"));

  await prisma.transaction.upsert({
    where: { workspaceId_fingerprint: { workspaceId: payload.workspaceId, fingerprint } },
    update: {
      merchantId: merchant.id,
      documentId: payload.documentId,
      extractionId: payload.extractionId,
      description: merchantName,
      currency,
      amountCents,
      occurredAt,
      deletedAt: null,
    },
    create: {
      workspaceId: payload.workspaceId,
      source: TransactionSource.UPLOAD,
      occurredAt,
      amountCents,
      currency,
      description: merchantName,
      merchantId: merchant.id,
      documentId: payload.documentId,
      extractionId: payload.extractionId,
      fingerprint,
    },
  });

  return { status: "upserted", year: occurredAt.getUTCFullYear(), month: occurredAt.getUTCMonth() + 1, currency };
}
