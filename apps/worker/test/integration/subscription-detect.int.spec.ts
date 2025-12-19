import { Queue, QueueEvents } from "bullmq";
import { GenericContainer } from "testcontainers";
import { execSync } from "node:child_process";
import { PrismaClient, SubscriptionInterval } from "@famfinance/db";
import { createSubscriptionDetectWorker } from "../../src/workers/subscription-detect.worker";

function runMigrations(databaseUrl: string) {
  execSync("pnpm --filter @famfinance/db migrate:deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

it("subscription_detect creates a monthly subscription from repeating transactions", async () => {
  const pg = await new GenericContainer("postgres:16")
    .withEnvironment({ POSTGRES_USER: "test", POSTGRES_PASSWORD: "test", POSTGRES_DB: "testdb" })
    .withExposedPorts(5432)
    .start();

  const redis = await new GenericContainer("redis:7").withExposedPorts(6379).start();

  const databaseUrl = `postgresql://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/testdb`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  });

  runMigrations(databaseUrl);

  const prisma = new PrismaClient();
  await prisma.$connect();

  const queue = new Queue("subscription_detect", { connection: { url: redisUrl } });
  const events = new QueueEvents("subscription_detect", { connection: { url: redisUrl } });
  const worker = createSubscriptionDetectWorker({ prisma });

  try {
    const user = await prisma.user.create({ data: { keycloakSub: "sub-1", email: "user@example.com" } });
    const ws = await prisma.workspace.create({
      data: { name: "Family", currency: "EUR", members: { create: { userId: user.id, role: "OWNER" } } },
    });

    const merchant = await prisma.merchant.create({
      data: { workspaceId: ws.id, name: "Netflix", normalized: "netflix" },
    });

    const dates = [
      new Date(Date.UTC(2025, 9, 1)),
      new Date(Date.UTC(2025, 10, 1)),
      new Date(Date.UTC(2025, 11, 1)),
    ];

    for (const d of dates) {
      await prisma.transaction.create({
        data: {
          workspaceId: ws.id,
          source: "EMAIL",
          occurredAt: d,
          amountCents: 1299,
          currency: "EUR",
          description: "Netflix",
          merchantId: merchant.id,
          fingerprint: `${ws.id}:${d.toISOString().slice(0, 10)}:1299:netflix:EUR`,
        },
      });
    }

    const job = await queue.add("subscription_detect", { workspaceId: ws.id }, { jobId: `subscription_detect-${ws.id}` });

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

    const subs = await prisma.subscription.findMany({ where: { workspaceId: ws.id } });
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]?.interval).toBe(SubscriptionInterval.MONTHLY);
    expect(subs[0]?.amountCents).toBe(1299);
  } finally {
    await worker.close();
    await events.close();
    await queue.close();
    await prisma.$disconnect();
    await pg.stop();
    await redis.stop();
  }
}, 120_000);
