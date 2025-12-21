import { ExtractionStatus } from "@famfinance/db";
import type { PrismaClient } from "@famfinance/db";

export type NormalizeJobPayload = {
  workspaceId: string;
  documentId: string;
  extractionId: string;
  engine: string;
};

type DetectedCurrency = "EUR" | "USD" | "GBP";

type NormalizedTxn = {
  occurredAt: string; // ISO
  amountCents: number;
  currency: string;
  merchantName: string;
  description?: string;
  rawLine?: string;
};

const SUMMARY_LINE_RE =
  /(BALANCE|SALDO|TOTAL|SUBTOTAL|OPENING|CLOSING|NEW BALANCE|PREVIOUS BALANCE|TOTAAL|EINDSALDO|BEGINSALDO)/i;

function detectCurrency(text: string): DetectedCurrency {
  const upper = text.toUpperCase();
  if (upper.includes("USD") || upper.includes("$")) return "USD";
  if (upper.includes("GBP") || upper.includes("£")) return "GBP";
  return "EUR";
}

function normalizeSpaces(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeSummaryLine(line: string): boolean {
  const upper = line.toUpperCase();
  if (!SUMMARY_LINE_RE.test(upper)) return false;
  // avoid filtering lines where the merchant name includes "Total" etc (rare but possible)
  return upper.length < 220;
}

function parseDateFromLine(line: string): { occurredAt: Date; matched: string } | null {
  // 2025-12-21 or 2025/12/21
  const iso = line.match(/\b(20\d{2})[\/.-](\d{2})[\/.-](\d{2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    const occurredAt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, matched: iso[0] };
  }

  // 21/12/2025 or 21-12-2025 or 21.12.2025
  const dmy = line.match(/\b(\d{2})[\/.-](\d{2})[\/.-](20\d{2})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const occurredAt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, matched: dmy[0] };
  }

  // 21/12/25 -> 2025
  const dmy2 = line.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{2})\b/);
  if (dmy2) {
    const [, d, m, y2] = dmy2;
    const year = 2000 + Number(y2);
    const occurredAt = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, matched: dmy2[0] };
  }

  return null;
}

function parseMoneyAmount(raw: string, fallbackCurrency: DetectedCurrency): { amountCents: number; currency: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const currency = (() => {
    const upper = trimmed.toUpperCase();
    if (upper.includes("EUR") || trimmed.includes("€")) return "EUR";
    if (upper.includes("USD") || trimmed.includes("$")) return "USD";
    if (upper.includes("GBP") || trimmed.includes("£")) return "GBP";
    return fallbackCurrency;
  })();

  const negative = /\(|-/.test(trimmed) || /-\s*$/.test(trimmed);

  // remove currency markers and whitespace
  let cleaned = trimmed
    .replace(/[()]/g, "")
    .replace(/\b(EUR|USD|GBP)\b/gi, "")
    .replace(/[€$£]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!cleaned) return null;

  // If both '.' and ',' exist, the last separator usually indicates decimals.
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const decimalSep = lastComma > lastDot ? "," : ".";

  // Remove thousands separators and normalize decimal separator to '.'
  if (decimalSep === ",") {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const signed = negative ? -Math.abs(value) : value;
  return { amountCents: Math.round(signed * 100), currency };
}

function extractAmountsFromLine(line: string, currency: DetectedCurrency): Array<{ raw: string; amountCents: number; currency: string }> {
  const results: Array<{ raw: string; amountCents: number; currency: string }> = [];
  const re =
    /([+-]?\(?\s*(?:EUR|USD|GBP)?\s*[€$£]?\s*\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})\s*\)?)/gi;

  for (const m of line.matchAll(re)) {
    const raw = m[0];
    const parsed = parseMoneyAmount(raw, currency);
    if (!parsed) continue;
    results.push({ raw, ...parsed });
  }

  return results;
}

function extractTransactionsFromText(text: string): NormalizedTxn[] {
  const currency = detectCurrency(text);
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const txns: NormalizedTxn[] = [];
  let pending: string | null = null;

  const pushTxn = (
    line: string,
    dateMatched: string,
    occurredAt: Date,
    amount: { amountCents: number; currency: string },
    amountRaw: string,
  ) => {
    const cleaned = normalizeSpaces(line);
    if (looksLikeSummaryLine(cleaned)) return;

    const description = normalizeSpaces(cleaned.replace(dateMatched, " ").replace(amountRaw, " "));

    // merchant name is best-effort; keep it short and readable
    const merchantName = normalizeSpaces(description.replace(SUMMARY_LINE_RE, "")).slice(0, 120) || "Unknown";
    if (!/[A-Za-zÀ-ÿ]/.test(merchantName)) return;

    txns.push({
      occurredAt: occurredAt.toISOString(),
      amountCents: amount.amountCents,
      currency: amount.currency,
      merchantName,
      description,
      rawLine: cleaned.slice(0, 500),
    });
  };

  for (const rawLine of lines) {
    const line = normalizeSpaces(rawLine);
    if (looksLikeSummaryLine(line)) continue;

    const date = parseDateFromLine(line);
    const amounts = extractAmountsFromLine(line, currency);

    if (date && amounts.length > 0) {
      const nonZero = amounts.filter((a) => a.amountCents !== 0);
      const chosen = (nonZero.length > 0 ? nonZero : amounts)[(nonZero.length > 0 ? nonZero : amounts).length - 1]!;
      pushTxn(line, date.matched, date.occurredAt, chosen, chosen.raw);
      pending = null;
      continue;
    }

    // Handle wrapped lines: a date line followed by an amount line
    if (date && amounts.length === 0) {
      pending = line;
      continue;
    }
    if (!date && amounts.length > 0 && pending) {
      const combined = normalizeSpaces(`${pending} ${line}`);
      const date2 = parseDateFromLine(combined);
      const amounts2 = extractAmountsFromLine(combined, currency);
      if (date2 && amounts2.length > 0) {
        const nonZero = amounts2.filter((a) => a.amountCents !== 0);
        const chosen = (nonZero.length > 0 ? nonZero : amounts2)[(nonZero.length > 0 ? nonZero : amounts2).length - 1]!;
        pushTxn(combined, date2.matched, date2.occurredAt, chosen, chosen.raw);
        pending = null;
        continue;
      }
      pending = null;
    }
  }

  // De-duplicate (PDF text can contain repeated header/footer lines).
  const unique = new Map<string, NormalizedTxn>();
  for (const t of txns) {
    const key = `${t.occurredAt}|${t.amountCents}|${t.currency}|${(t.merchantName || "").toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, t);
  }

  return [...unique.values()];
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

function parseSingleTransactionFallback(text: string): NormalizedTxn[] {
  const currency = detectCurrency(text);
  const amount = (() => {
    const patterns = [
      /(?:TOTAL|AMOUNT|AMOUNT PAID|PAID)\s*[:=]?\s*(?:EUR|USD|GBP|€|\$|£)?\s*([+-]?[0-9]+(?:[.,][0-9]{2})?)/i,
      /(?:EUR|USD|GBP|€|\$|£)\s*([+-]?[0-9]+(?:[.,][0-9]{2})?)/i,
      /([+-]?[0-9]+(?:[.,][0-9]{2})?)\s*(?:EUR|USD|GBP|€|\$|£)/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const parsed = parseMoneyAmount(m[1] ?? m[0], currency);
      if (parsed) return parsed;
    }
    return null;
  })();

  const occurredAt = parseOccurredAt(text);
  const merchantName = parseMerchantName(text);
  if (!amount || !occurredAt || !merchantName) return [];

  return [
    {
      occurredAt: occurredAt.toISOString(),
      amountCents: amount.amountCents,
      currency: amount.currency,
      merchantName,
      description: merchantName,
    },
  ];
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
  const txns = extractTransactionsFromText(text);
  const normalizedTxns = txns.length > 0 ? txns : parseSingleTransactionFallback(text);

  if (normalizedTxns.length === 0) {
    await prisma.extraction.update({
      where: { id: extraction.id },
      data: {
        status: ExtractionStatus.FAILED,
        normalizedJson: {
          ok: false,
          reason: "missing_fields",
          found: { transactions: 0 },
        },
        errorCode: "NORMALIZE_FAILED",
        errorMessage: "Could not detect any transaction lines from extracted text.",
        finishedAt: new Date(),
      },
    });
    return { status: "normalized_partial" };
  }

  await prisma.extraction.update({
    where: { id: extraction.id },
    data: {
      status: ExtractionStatus.SUCCEEDED,
      normalizedJson: {
        ok: true,
        version: 1,
        currency: detectCurrency(text),
        transactions: normalizedTxns,
      },
      errorCode: null,
      errorMessage: null,
    },
  });

  return { status: "normalized", count: normalizedTxns.length };
}
