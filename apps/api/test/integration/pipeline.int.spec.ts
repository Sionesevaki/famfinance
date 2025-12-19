import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@famfinance/db";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";
import { S3Storage } from "../../../worker/src/storage/s3";
import { createDocExtractWorker } from "../../../worker/src/workers/doc-extract.worker";
import { createNormalizeWorker } from "../../../worker/src/workers/normalize.worker";
import { createTxUpsertWorker } from "../../../worker/src/workers/tx-upsert.worker";
import { createRollupMonthlyWorker } from "../../../worker/src/workers/rollup-monthly.worker";

let app: INestApplication;
let infra: Awaited<ReturnType<typeof startInfra>>;
let prisma: PrismaClient;

beforeAll(async () => {
  infra = await startInfra();
  runMigrations(infra.env.DATABASE_URL);
  prisma = new PrismaClient({ datasources: { db: { url: infra.env.DATABASE_URL } } });
  await prisma.$connect();
  app = await createTestApp(infra.env);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await infra.pg.stop();
  await infra.redis.stop();
  await infra.minio.stop();
}, 120_000);

it("doc -> extraction -> normalize -> tx_upsert -> rollup -> analytics summary", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const text = ["CoffeeShop", "Amount: EUR 12.34", "Date: 2025-12-17"].join("\n");
  const presign = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/documents/upload-url`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ filename: "receipt.txt", mimeType: "text/plain", sizeBytes: text.length })
    .expect(201);

  const { documentId, uploadUrl, uploadHeaders } = presign.body as {
    documentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: new TextEncoder().encode(text),
  });
  expect(uploadRes.status).toBeGreaterThanOrEqual(200);
  expect(uploadRes.status).toBeLessThan(300);

  // Start workers after infra env is applied.
  Object.assign(process.env, infra.env);
  const s3 = new S3Storage();
  const docExtract = createDocExtractWorker({ prisma, s3 });
  const normalize = createNormalizeWorker({ prisma });
  const txUpsert = createTxUpsertWorker({ prisma });
  const rollup = createRollupMonthlyWorker({ prisma });

  try {
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/documents/${documentId}/complete`)
      .set("x-test-sub", "sub-user-1")
      .set("x-test-email", "user1@example.com")
      .expect(200);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const txnCount = await prisma.transaction.count({ where: { workspaceId } });
      const rollupCount = await prisma.analyticsMonthlyRollup.count({
        where: { workspaceId, year: 2025, month: 12, currency: "EUR" },
      });
      if (txnCount >= 1 && rollupCount >= 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const txns = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/transactions`)
      .set("x-test-sub", "sub-user-1")
      .set("x-test-email", "user1@example.com")
      .expect(200);

    expect(txns.body.length).toBeGreaterThanOrEqual(1);
    expect(txns.body[0].amountCents).toBe(1234);

    const summary = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/analytics/summary?month=2025-12`)
      .set("x-test-sub", "sub-user-1")
      .set("x-test-email", "user1@example.com")
      .expect(200);

    expect(summary.body.totalCents).toBe(1234);
    expect(summary.body.byMerchant["CoffeeShop"]).toBe(1234);
  } finally {
    await docExtract.close();
    await normalize.close();
    await txUpsert.close();
    await rollup.close();
  }
}, 120_000);

