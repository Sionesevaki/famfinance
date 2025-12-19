import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { processRollupMonthly, type RollupMonthlyPayload } from "../processors/rollup-monthly.processor";

export function createRollupMonthlyWorker(params: { prisma: PrismaClient }) {
  const redisUrl = requireEnv("REDIS_URL");
  return new Worker<RollupMonthlyPayload>(
    "rollup_monthly",
    async (job) => {
      return processRollupMonthly({ prisma: params.prisma, payload: job.data });
    },
    { connection: { url: redisUrl } },
  );
}

