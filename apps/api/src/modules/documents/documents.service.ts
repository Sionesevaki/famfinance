import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { DocumentType } from "@famfinance/db";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { S3Service } from "../../storage/s3.service";
import { requireEnv } from "@famfinance/lib";

type CreateUploadUrlParams = {
  workspaceId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  type?: DocumentType;
};

@Injectable()
export class DocumentsService implements OnModuleDestroy {
  private readonly extractionQueue = new Queue("doc_extract", {
    connection: { url: requireEnv("REDIS_URL") },
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async onModuleDestroy() {
    await this.extractionQueue.close();
  }

  async createUploadUrl(params: CreateUploadUrlParams) {
    await this.s3.ensureBucket();

    const storageKey = `workspaces/${params.workspaceId}/documents/${randomUUID()}/${params.filename}`;

    const document = await this.prisma.document.create({
      data: {
        workspaceId: params.workspaceId,
        uploadedById: params.uploadedById,
        type: params.type ?? DocumentType.OTHER,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        storageKey,
      },
      select: { id: true, storageKey: true },
    });

    const upload = await this.s3.presignPutObject({
      key: document.storageKey,
      contentType: params.mimeType,
    });

    return {
      documentId: document.id,
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      storageKey: document.storageKey,
    };
  }

  async completeUpload(params: { workspaceId: string; documentId: string }) {
    const doc = await this.prisma.document.findFirst({
      where: { id: params.documentId, workspaceId: params.workspaceId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException("Document not found");

    const exists = await this.s3.objectExists(doc.storageKey);
    if (!exists) throw new BadRequestException("Uploaded object not found in storage");

    const extraction = await this.prisma.extraction.upsert({
      where: { documentId_engine: { documentId: doc.id, engine: "pipeline-v1" } },
      update: { status: "PENDING", errorCode: null, errorMessage: null, startedAt: null, finishedAt: null },
      create: { workspaceId: doc.workspaceId, documentId: doc.id, engine: "pipeline-v1", status: "PENDING" },
      select: { id: true },
    });

    await this.extractionQueue.add(
      "doc_extract",
      { documentId: doc.id, workspaceId: doc.workspaceId, engine: "pipeline-v1", extractionId: extraction.id },
      {
        jobId: `doc_extract-${doc.id}-pipeline-v1`,
        attempts: 8,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async listDocuments(params: {
    workspaceId: string;
    type?: DocumentType;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const docs = await this.prisma.document.findMany({
      where: { workspaceId: params.workspaceId, deletedAt: null, type: params.type },
      orderBy: { uploadedAt: "desc" },
      skip: offset,
      take: limit,
      include: {
        extractions: { where: { engine: "pipeline-v1" }, take: 1 },
      },
    });

    return docs.map((d) => ({
      documentId: d.id,
      type: d.type,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      extractionStatus: d.extractions[0]?.status ?? null,
    }));
  }

  async getDocument(params: { workspaceId: string; documentId: string }) {
    const doc = await this.prisma.document.findFirst({
      where: { id: params.documentId, workspaceId: params.workspaceId, deletedAt: null },
      include: { extractions: { where: { engine: "pipeline-v1" }, take: 1 } },
    });
    if (!doc) throw new NotFoundException("Document not found");

    return {
      documentId: doc.id,
      type: doc.type,
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
      extraction: doc.extractions[0]
        ? {
            extractionId: doc.extractions[0].id,
            status: doc.extractions[0].status,
            errorCode: doc.extractions[0].errorCode,
            errorMessage: doc.extractions[0].errorMessage,
          }
        : null,
    };
  }

  async getDownloadUrl(params: { workspaceId: string; documentId: string }) {
    const doc = await this.prisma.document.findFirst({
      where: { id: params.documentId, workspaceId: params.workspaceId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException("Document not found");

    await this.s3.ensureBucket();
    const url = await this.s3.presignGetObject({ key: doc.storageKey });
    return { url };
  }

  async softDelete(params: { workspaceId: string; documentId: string }) {
    const doc = await this.prisma.document.findFirst({
      where: { id: params.documentId, workspaceId: params.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException("Document not found");

    await this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date() },
    });
  }
}
