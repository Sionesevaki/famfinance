import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { S3Storage } from "../storage/s3";
import { processDocExtract, type DocExtractJobPayload } from "../processors/doc-extract.processor";
import { Queue } from "bullmq";

export function createDocExtractWorker(params: { prisma: PrismaClient; s3: S3Storage }) {
  const redisUrl = requireEnv("REDIS_URL");
  const normalizeQueue = new Queue("normalize", { connection: { url: redisUrl } });

  const worker = new Worker<DocExtractJobPayload>(
    "doc_extract",
    async (job) => {
      const res = await processDocExtract({ prisma: params.prisma, s3: params.s3, payload: job.data });
      if (res.status === "succeeded") {
        await normalizeQueue.add(
          "normalize",
          {
            workspaceId: job.data.workspaceId,
            documentId: job.data.documentId,
            extractionId: job.data.extractionId,
            engine: job.data.engine,
          },
          {
            jobId: `normalize-${job.data.documentId}-${job.data.engine}`,
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
    await normalizeQueue.close();
  };

  return worker;
}
