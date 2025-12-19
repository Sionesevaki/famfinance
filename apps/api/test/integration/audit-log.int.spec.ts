import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@famfinance/db";
import { Queue, Worker } from "bullmq";
import { createTestApp } from "./setup/app";
import { startInfra } from "./setup/testcontainers";
import { runMigrations } from "./setup/run-migrations";

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

it("writes audit logs for invite revoke and email disconnect", async () => {
  await request(app.getHttpServer())
    .get("/me")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  const ws = await request(app.getHttpServer())
    .post("/workspaces")
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ name: "Family", currency: "EUR" })
    .expect(201);

  const workspaceId = ws.body.workspaceId as string;

  const inv = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ email: "invitee@example.com", role: "MEMBER" })
    .expect(201);

  await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/invites/${inv.body.inviteId}/revoke`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  const revokeLog = await prisma.auditLog.findFirst({
    where: { action: "workspace_invite_revoked", workspaceId, targetId: inv.body.inviteId },
  });
  expect(revokeLog).toBeTruthy();

  const connected = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/integrations/email/gmail/callback`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .send({ providerEmail: "owner@gmail.test", accessToken: "token-1", refreshToken: "refresh-1" })
    .expect(201);

  const connectedId = connected.body.connectedEmailAccountId as string;

  await request(app.getHttpServer())
    .delete(`/workspaces/${workspaceId}/integrations/email/${connectedId}`)
    .set("x-test-sub", "sub-owner")
    .set("x-test-email", "owner@example.com")
    .expect(200);

  const disconnectLog = await prisma.auditLog.findFirst({
    where: { action: "email_integration_disconnected", workspaceId, targetId: connectedId },
  });
  expect(disconnectLog).toBeTruthy();
});

it("writes audit logs for admin job retry", async () => {
  const connection = { url: infra.env.REDIS_URL };
  const queue = new Queue("doc_extract", { connection });
  const worker = new Worker(
    "doc_extract",
    async () => {
      throw new Error("boom");
    },
    { connection, concurrency: 1 },
  );

  await worker.waitUntilReady();
  const job = await queue.add("doc_extract", { test: true }, { attempts: 1, removeOnComplete: true, removeOnFail: false });

  const start = Date.now();
  while (Date.now() - start < 15_000) {
    const state = await job.getState();
    if (state === "failed") break;
    await new Promise((r) => setTimeout(r, 100));
  }

  expect(await job.getState()).toBe("failed");
  await worker.close();

  const failed = await request(app.getHttpServer())
    .get("/admin/jobs/failed")
    .query({ queue: "doc_extract", limit: 10, offset: 0 })
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  expect(Array.isArray(failed.body)).toBe(true);
  expect(
    (failed.body as Array<{ jobId: string | number | null }>).some((j) => String(j.jobId) === String(job.id)),
  ).toBe(true);

  await request(app.getHttpServer())
    .post(`/admin/jobs/${job.id}/retry`)
    .query({ queue: "doc_extract" })
    .set("x-test-sub", "sub-admin-1")
    .set("x-test-email", "admin1@example.com")
    .set("x-test-roles", "platform_admin")
    .expect(200);

  const retryLog = await prisma.auditLog.findFirst({
    where: { action: "admin_job_retried", targetId: String(job.id) },
  });
  expect(retryLog).toBeTruthy();

  await queue.close();
});
