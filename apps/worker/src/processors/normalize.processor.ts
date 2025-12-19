import { ExtractionStatus } from "@famfinance/db";
import type { PrismaClient } from "@famfinance/db";

export type NormalizeJobPayload = {
  workspaceId: string;
  documentId: string;
  extractionId: string;
  engine: string;
};

function parseAmountCents(text: string): { amountCents: number; currency: string } | null {
  const upper = text.toUpperCase();
  const currency = upper.includes("EUR") || upper.includes("€") ? "EUR" : "EUR";

  const patterns = [
    /(?:TOTAL|AMOUNT|AMOUNT PAID|PAID)\s*[:=]?\s*(?:EUR|€)?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /(?:EUR|€)\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /([0-9]+(?:[.,][0-9]{2})?)\s*(?:EUR|€)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const raw = m[1].replace(",", ".");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    return { amountCents: Math.round(value * 100), currency };
  }

  return null;
}

function parseOccurredAt(text: string): Date | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const dmy = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  return null;
}

function parseMerchantName(text: string): string | null {
  const m = text.match(/(?:MERCHANT|FROM)\s*[:=]\s*(.+)/i);
  if (m) return m[1].trim().slice(0, 120);

  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  return firstLine.slice(0, 120);
}

export async function processNormalize(params: {
  prisma: PrismaClient;
  payload: NormalizeJobPayload;
}) {
  const { prisma, payload } = params;

  const extraction = await prisma.extraction.findFirst({
    where: { id: payload.extractionId, workspaceId: payload.workspaceId, documentId: payload.documentId },
  });
  if (!extraction) throw new Error("Extraction not found");
  if (extraction.engine !== payload.engine) throw new Error("Extraction engine mismatch");
  if (extraction.status !== ExtractionStatus.SUCCEEDED) throw new Error("Extraction not ready");

  const text = extraction.extractedText ?? "";
  const amount = parseAmountCents(text);
  const occurredAt = parseOccurredAt(text);
  const merchantName = parseMerchantName(text);

  if (!amount || !occurredAt || !merchantName) {
    await prisma.extraction.update({
      where: { id: extraction.id },
      data: {
        normalizedJson: {
          ok: false,
          reason: "missing_fields",
          found: {
            amount: Boolean(amount),
            occurredAt: Boolean(occurredAt),
            merchantName: Boolean(merchantName),
          },
        },
      },
    });
    return { status: "normalized_partial" };
  }

  await prisma.extraction.update({
    where: { id: extraction.id },
    data: {
      normalizedJson: {
        ok: true,
        merchantName,
        occurredAt: occurredAt.toISOString(),
        amountCents: amount.amountCents,
        currency: amount.currency,
      },
    },
  });

  return { status: "normalized" };
}
