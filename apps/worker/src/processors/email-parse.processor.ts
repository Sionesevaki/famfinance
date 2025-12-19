import type { PrismaClient } from "@famfinance/db";
import { DocumentType, ExtractionStatus } from "@famfinance/db";
import { Queue } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import { S3Storage } from "../storage/s3";

export type EmailParsePayload = {
  workspaceId: string;
  connectedId: string;
  providerMsgId: string;
  emailMessageId: string;
  attachments: { filename: string; mimeType: string; bodyBase64: string }[];
};

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

export async function processEmailParse(params: { prisma: PrismaClient; s3: S3Storage; payload: EmailParsePayload }) {
  const { prisma, s3, payload } = params;
  const docExtractQueue = new Queue("doc_extract", { connection: { url: requireEnv("REDIS_URL") } });

  try {
    await s3.ensureBucket();

    for (const a of payload.attachments) {
      const key = `workspaces/${payload.workspaceId}/email/${payload.providerMsgId}/${safeFilename(a.filename)}`;
      const body = Buffer.from(a.bodyBase64, "base64");

      await s3.putObject({ key, body, contentType: a.mimeType });

      const doc = await prisma.document.upsert({
        where: { storageKey: key },
        update: { deletedAt: null, mimeType: a.mimeType, filename: a.filename, sizeBytes: body.length, emailMessageId: payload.emailMessageId },
        create: {
          workspaceId: payload.workspaceId,
          type: DocumentType.OTHER,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: body.length,
          storageKey: key,
          emailMessageId: payload.emailMessageId,
        },
        select: { id: true, workspaceId: true },
      });

      const extraction = await prisma.extraction.upsert({
        where: { documentId_engine: { documentId: doc.id, engine: "pipeline-v1" } },
        update: { status: ExtractionStatus.PENDING, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null },
        create: { workspaceId: doc.workspaceId, documentId: doc.id, engine: "pipeline-v1", status: ExtractionStatus.PENDING },
        select: { id: true },
      });

      await docExtractQueue.add(
        "doc_extract",
        { workspaceId: payload.workspaceId, documentId: doc.id, extractionId: extraction.id, engine: "pipeline-v1" },
        {
          jobId: `doc_extract-${doc.id}-pipeline-v1`,
          attempts: 8,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }

    return { status: "parsed", attachments: payload.attachments.length };
  } finally {
    await docExtractQueue.close();
  }
}

