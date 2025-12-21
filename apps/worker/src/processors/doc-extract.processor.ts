import { ExtractionStatus } from "@famfinance/db";
import pdfParse from "pdf-parse";
import { S3Storage } from "../storage/s3";
import type { PrismaClient } from "@famfinance/db";

function getAwsErrorInfo(err: unknown): { httpStatusCode?: number; code?: string } {
  if (!err || typeof err !== "object") return {};
  const anyErr = err as Record<string, unknown>;

  let httpStatusCode: number | undefined;
  const metadata = anyErr.$metadata;
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (typeof m.httpStatusCode === "number") httpStatusCode = m.httpStatusCode;
  }
  const codeRaw = anyErr.Code ?? anyErr.code ?? anyErr.name;
  const code = typeof codeRaw === "string" ? codeRaw : undefined;

  return { httpStatusCode, code };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export type DocExtractJobPayload = {
  workspaceId: string;
  documentId: string;
  extractionId: string;
  engine: string;
};

export async function processDocExtract(params: {
  prisma: PrismaClient;
  s3: S3Storage;
  payload: DocExtractJobPayload;
}) {
  const now = new Date();
  const { prisma, s3, payload } = params;

  const extraction = await prisma.extraction.findFirst({
    where: { id: payload.extractionId, workspaceId: payload.workspaceId, documentId: payload.documentId },
  });
  if (!extraction) throw new Error("Extraction not found");
  if (extraction.engine !== payload.engine) throw new Error("Extraction engine mismatch");
  if (extraction.status === ExtractionStatus.SUCCEEDED) return { status: "already_succeeded" };

  await prisma.extraction.update({
    where: { id: extraction.id },
    data: {
      status: ExtractionStatus.PROCESSING,
      startedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    },
  });

  try {
    const doc = await prisma.document.findFirst({
      where: { id: payload.documentId, workspaceId: payload.workspaceId, deletedAt: null },
    });
    if (!doc) throw new Error("Document not found");

    await s3.ensureBucket();
    const buf = await s3.getObjectBuffer(doc.storageKey);

    let extractedText: string | null = null;
    if (doc.mimeType.startsWith("text/")) {
      extractedText = buf.toString("utf-8");
    } else if (doc.mimeType === "application/pdf") {
      const res = await pdfParse(buf);
      extractedText = res.text;
    } else {
      await prisma.extraction.update({
        where: { id: extraction.id },
        data: {
          status: ExtractionStatus.FAILED,
          finishedAt: new Date(),
          errorCode: "UNSUPPORTED_MIME",
          errorMessage: `Unsupported mimeType: ${doc.mimeType}`,
        },
      });
      return { status: "failed_unsupported_mime" };
    }

    await prisma.extraction.update({
      where: { id: extraction.id },
      data: {
        status: ExtractionStatus.SUCCEEDED,
        finishedAt: new Date(),
        extractedText,
      },
    });

    return { status: "succeeded" };
  } catch (err: unknown) {
    const { code } = getAwsErrorInfo(err);
    const errorCode =
      code === "NoSuchKey" || code === "NotFound"
        ? "STORAGE_NOT_FOUND"
        : code === "AccessDenied" || code === "Forbidden"
          ? "STORAGE_ACCESS_DENIED"
          : "EXTRACT_FAILED";

    await prisma.extraction.update({
      where: { id: extraction.id },
      data: {
        status: ExtractionStatus.FAILED,
        finishedAt: new Date(),
        errorCode,
        errorMessage: toErrorMessage(err).slice(0, 1000),
      },
    });

    return { status: "failed" };
  }
}
