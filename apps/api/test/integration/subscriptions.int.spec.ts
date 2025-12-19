import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@famfinance/db";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";
import { createSubscriptionDetectWorker } from "../../../worker/src/workers/subscription-detect.worker";

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

it("POST /subscriptions/detect enqueues and worker creates subscriptions", async () => {
  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  Object.assign(process.env, infra.env);
  const worker = createSubscriptionDetectWorker({ prisma });

  try {
    const merchant = await prisma.merchant.create({
      data: { workspaceId, name: "Spotify", normalized: "spotify" },
    });

    const dates = [
      new Date(Date.UTC(2025, 9, 5)),
      new Date(Date.UTC(2025, 10, 5)),
      new Date(Date.UTC(2025, 11, 5)),
    ];

    for (const d of dates) {
      await prisma.transaction.create({
        data: {
          workspaceId,
          source: "UPLOAD",
          occurredAt: d,
          amountCents: 999,
          currency: "EUR",
          description: "Spotify",
          merchantId: merchant.id,
          fingerprint: `${workspaceId}:${d.toISOString().slice(0, 10)}:999:spotify:EUR`,
        },
      });
    }

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/subscriptions/detect`)
      .set("x-test-sub", "sub-owner")
      .set("x-test-email", "owner@example.com")
      .expect(200)
      .expect((res) => {
        expect(res.body.queued).toBe(true);
        expect(res.body.jobId).toBeTruthy();
      });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const count = await prisma.subscription.count({ where: { workspaceId } });
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const list = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/subscriptions`)
      .set("x-test-sub", "sub-owner")
      .set("x-test-email", "owner@example.com")
      .expect(200);

    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0].name).toBe("Spotify");
  } finally {
    await worker.close();
  }
}, 120_000);

