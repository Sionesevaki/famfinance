import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { processEmailSync, type EmailSyncPayload } from "../processors/email-sync.processor";

export function createEmailSyncWorker(params: { prisma: PrismaClient }) {
  const redisUrl = requireEnv("REDIS_URL");
  return new Worker<EmailSyncPayload>(
    "email_sync",
    async (job) => {
      return processEmailSync({ prisma: params.prisma, payload: job.data });
    },
    { connection: { url: redisUrl } },
  );
}

