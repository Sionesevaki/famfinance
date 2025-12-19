import { Queue, QueueEvents } from "bullmq";
import { GenericContainer } from "testcontainers";
import { execSync } from "node:child_process";
import { PrismaClient, ExtractionStatus, DocumentType } from "@famfinance/db";
import { createDocExtractWorker } from "../../src/workers/doc-extract.worker";
import { S3Storage } from "../../src/storage/s3";

function runMigrations(databaseUrl: string) {
  execSync("pnpm --filter @famfinance/db migrate:deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

it("doc_extract worker updates Extraction and writes extractedText", async () => {
  const pg = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "test", POSTGRES_PASSWORD: "test", POSTGRES_DB: "testdb" })
    .withExposedPorts(5432)
    .start();

  const redis = await new GenericContainer("redis:7").withExposedPorts(6379).start();

  const minio = await new GenericContainer("minio/minio:latest")
    .withEnvironment({ MINIO_ROOT_USER: "minio", MINIO_ROOT_PASSWORD: "minio123" })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .start();

  const databaseUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/testdb`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  const s3Endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: s3Endpoint,
    S3_ACCESS_KEY: "minio",
    S3_SECRET_KEY: "minio123",
    S3_BUCKET: "test-bucket",
  });

  runMigrations(databaseUrl);

  const prisma = new PrismaClient();
  await prisma.$connect();

  const s3 = new S3Storage();
  await s3.ensureBucket();

  const queue = new Queue("doc_extract", { connection: { url: redisUrl } });
  const events = new QueueEvents("doc_extract", { connection: { url: redisUrl } });

  const worker = createDocExtractWorker({ prisma, s3 });

  try {
    const user = await prisma.user.create({
      data: { keycloakSub: "sub-1", email: "user@example.com" },
    });
    const ws = await prisma.workspace.create({
      data: { name: "Family", currency: "EUR", members: { create: { userId: user.id, role: "OWNER" } } },
    });

    const storageKey = `workspaces/${ws.id}/documents/test.txt`;
    await s3.putObject({ key: storageKey, body: Buffer.from("hello worker"), contentType: "text/plain" });

    const doc = await prisma.document.create({
      data: {
        workspaceId: ws.id,
        type: DocumentType.OTHER,
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        storageKey,
        uploadedById: user.id,
      },
    });

    const extraction = await prisma.extraction.create({
      data: { workspaceId: ws.id, documentId: doc.id, engine: "pipeline-v1", status: ExtractionStatus.PENDING },
    });

    const job = await queue.add(
      "doc_extract",
      { workspaceId: ws.id, documentId: doc.id, extractionId: extraction.id, engine: "pipeline-v1" },
      { jobId: `doc_extract-${doc.id}-pipeline-v1` },
    );

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for job completion")), 30_000);
      events.on("completed", ({ jobId }) => {
        if (jobId === job.id) {
          clearTimeout(t);
          resolve();
        }
      });
      events.on("failed", ({ jobId, failedReason }) => {
        if (jobId === job.id) {
          clearTimeout(t);
          reject(new Error(failedReason || "job failed"));
        }
      });
    });

    const updated = await prisma.extraction.findUnique({ where: { id: extraction.id } });
    expect(updated?.status).toBe(ExtractionStatus.SUCCEEDED);
    expect(updated?.extractedText).toContain("hello worker");
  } finally {
    await worker.close();
    await events.close();
    await queue.close();
    await prisma.$disconnect();
    await pg.stop();
    await redis.stop();
    await minio.stop();
  }
}, 120_000);
