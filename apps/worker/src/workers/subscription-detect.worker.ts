import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { processSubscriptionDetect, type SubscriptionDetectPayload } from "../processors/subscription-detect.processor";

export function createSubscriptionDetectWorker(params: { prisma: PrismaClient }) {
  const redisUrl = requireEnv("REDIS_URL");
  return new Worker<SubscriptionDetectPayload>(
    "subscription_detect",
    async (job) => {
      return processSubscriptionDetect({ prisma: params.prisma, payload: job.data });
    },
    { connection: { url: redisUrl } },
  );
}

