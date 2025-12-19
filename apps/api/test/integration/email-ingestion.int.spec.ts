import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@famfinance/db";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";
import { S3Storage } from "../../../worker/src/storage/s3";
import { createEmailSyncWorker } from "../../../worker/src/workers/email-sync.worker";
import { createEmailParseWorker } from "../../../worker/src/workers/email-parse.worker";
import { createDocExtractWorker } from "../../../worker/src/workers/doc-extract.worker";
import { createNormalizeWorker } from "../../../worker/src/workers/normalize.worker";
import { createTxUpsertWorker } from "../../../worker/src/workers/tx-upsert.worker";
import { createRollupMonthlyWorker } from "../../../worker/src/workers/rollup-monthly.worker";

let app: INestApplication;
let infra: Awaited<ReturnType<typeof startInfra>>;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.OAUTH_ALLOWED_REDIRECT_URIS = "https://app.example.com/oauth/callback";
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

it("rejects email connect-url when redirectUri is not allowlisted", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/integrations/email/gmail/connect-url`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ redirectUri: "https://evil.example.com/callback" })
    .expect(400);
});

it("email sync ingests attachment into pipeline and produces a transaction", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const connected = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/integrations/email/gmail/callback`)
    .set("x-test-sub", "sub-user-1")
    .set("x-test-email", "user1@example.com")
    .send({ providerEmail: "user1@gmail.com", accessToken: "token" })
    .expect(201);

  const connectedId = connected.body.connectedEmailAccountId as string;
  expect(connectedId).toBeTruthy();

  Object.assign(process.env, infra.env);
  const s3 = new S3Storage();
  const emailSync = createEmailSyncWorker({ prisma });
  const emailParse = createEmailParseWorker({ prisma, s3 });
  const docExtract = createDocExtractWorker({ prisma, s3 });
  const normalize = createNormalizeWorker({ prisma });
  const txUpsert = createTxUpsertWorker({ prisma });
  const rollup = createRollupMonthlyWorker({ prisma });

  try {
    const receiptText = ["CoffeeShop", "Amount: EUR 12.34", "Date: 2025-12-17"].join("\n");
    const mockMessages = [
      {
        providerMsgId: "msg-1",
        subject: "Receipt",
        fromEmail: "billing@coffeeshop.example",
        sentAt: "2025-12-17T10:00:00Z",
        snippet: "Thanks for your purchase",
        attachments: [
          {
            filename: "receipt.txt",
            mimeType: "text/plain",
            bodyBase64: Buffer.from(receiptText, "utf8").toString("base64"),
          },
        ],
      },
    ];

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/integrations/email/${connectedId}/sync`)
      .set("x-test-sub", "sub-user-1")
      .set("x-test-email", "user1@example.com")
      .send({ mockMessages })
      .expect(200);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const txnCount = await prisma.transaction.count({ where: { workspaceId } });
      if (txnCount >= 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const txns = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/transactions`)
      .set("x-test-sub", "sub-user-1")
      .set("x-test-email", "user1@example.com")
      .expect(200);

    expect(txns.body.length).toBeGreaterThanOrEqual(1);
    expect(txns.body[0].amountCents).toBe(1234);
    expect(txns.body[0].merchant?.name).toBe("CoffeeShop");
  } finally {
    await emailSync.close();
    await emailParse.close();
    await docExtract.close();
    await normalize.close();
    await txUpsert.close();
    await rollup.close();
  }
}, 120_000);
