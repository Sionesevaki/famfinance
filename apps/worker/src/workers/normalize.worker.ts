import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { processNormalize, type NormalizeJobPayload } from "../processors/normalize.processor";
import { Queue } from "bullmq";

export function createNormalizeWorker(params: { prisma: PrismaClient }) {
  const redisUrl = requireEnv("REDIS_URL");
  const txUpsertQueue = new Queue("tx_upsert", { connection: { url: redisUrl } });

  const worker = new Worker<NormalizeJobPayload>(
    "normalize",
    async (job) => {
      const res = await processNormalize({ prisma: params.prisma, payload: job.data });
      if (res.status === "normalized") {
        await txUpsertQueue.add(
          "tx_upsert",
          {
            workspaceId: job.data.workspaceId,
            documentId: job.data.documentId,
            extractionId: job.data.extractionId,
            engine: job.data.engine,
          },
          {
            jobId: `tx_upsert-${job.data.documentId}-${job.data.engine}`,
            attempts: 8,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }
      return res;
    },
    { connection: { url: redisUrl } },
  );

  const originalClose = worker.close.bind(worker);
  worker.close = async () => {
    await originalClose();
    await txUpsertQueue.close();
  };

  return worker;
}
