import { createHash } from "node:crypto";
import { TransactionSource } from "@famfinance/db";
import type { PrismaClient } from "@famfinance/db";

export type TxUpsertJobPayload = {
  workspaceId: string;
  documentId: string;
  extractionId: string;
  engine: string;
};

type NormalizedTxn = {
  occurredAt: string;
  amountCents: number;
  currency?: string;
  merchantName: string;
  description?: string;
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

function normalizeDescription(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
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

  const txns: NormalizedTxn[] = (() => {
    const obj = normalized as Record<string, unknown>;
    const maybeTxns = obj.transactions;
    if (Array.isArray(maybeTxns)) return maybeTxns as NormalizedTxn[];

    // Backwards-compat: single-transaction shape
    if ("occurredAt" in obj && "amountCents" in obj && "merchantName" in obj) {
      return [
        {
          occurredAt: String(obj.occurredAt),
          amountCents: Number(obj.amountCents),
          currency: typeof obj.currency === "string" ? obj.currency : undefined,
          merchantName: String(obj.merchantName),
          description: typeof obj.description === "string" ? obj.description : undefined,
        },
      ];
    }

    return [];
  })();

  if (txns.length === 0) return { status: "skipped_not_normalized" };

  const rollupKeySet = new Set<string>();
  let upsertedCount = 0;
  for (const t of txns) {
    const occurredAt = new Date(t.occurredAt);
    const amountCents = Number(t.amountCents);
    const currency = String(t.currency || "EUR");
    const merchantName = String(t.merchantName || t.description || "").trim();
    const description = String(t.description || t.merchantName || "").trim() || null;

    if (Number.isNaN(occurredAt.getTime())) continue;
    if (!Number.isFinite(amountCents)) continue;
    if (!merchantName) continue;

    const merchantNormalized = normalizeMerchant(merchantName);
    const merchant = await prisma.merchant.upsert({
      where: { workspaceId_normalized: { workspaceId: payload.workspaceId, normalized: merchantNormalized } },
      update: { name: merchantName },
      create: { workspaceId: payload.workspaceId, name: merchantName, normalized: merchantNormalized },
    });

    const fingerprint = sha256Hex(
      [
        payload.workspaceId,
        occurredAt.toISOString(),
        String(amountCents),
        currency,
        merchantNormalized,
        description ? normalizeDescription(description) : "",
      ].join("|"),
    );

    await prisma.transaction.upsert({
      where: { workspaceId_fingerprint: { workspaceId: payload.workspaceId, fingerprint } },
      update: {
        merchantId: merchant.id,
        documentId: payload.documentId,
        extractionId: payload.extractionId,
        description,
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
        description,
        merchantId: merchant.id,
        documentId: payload.documentId,
        extractionId: payload.extractionId,
        fingerprint,
      },
    });

    upsertedCount += 1;
    const y = occurredAt.getUTCFullYear();
    const m = occurredAt.getUTCMonth() + 1;
    rollupKeySet.add(`${y}-${m}-${currency}`);
  }

  const rollups = [...rollupKeySet].map((k) => {
    const [y, m, c] = k.split("-");
    return { year: Number(y), month: Number(m), currency: String(c) };
  });

  return { status: "upserted", count: upsertedCount, rollups };
}
