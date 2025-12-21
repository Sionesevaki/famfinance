import { Queue, Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { processTxUpsert, type TxUpsertJobPayload } from "../processors/tx-upsert.processor";

export function createTxUpsertWorker(params: { prisma: PrismaClient }) {
  const redisUrl = requireEnv("REDIS_URL");
  const rollupQueue = new Queue("rollup_monthly", { connection: { url: redisUrl } });

  const worker = new Worker<TxUpsertJobPayload>(
    "tx_upsert",
    async (job) => {
      const res = await processTxUpsert({ prisma: params.prisma, payload: job.data });
      if (res.status === "upserted") {
        const rollups = (res as { rollups?: Array<{ year: number; month: number; currency: string }> }).rollups ?? [];
        for (const r of rollups) {
          await rollupQueue.add(
            "rollup_monthly",
            { workspaceId: job.data.workspaceId, year: r.year, month: r.month, currency: r.currency },
            {
              jobId: `rollup-${job.data.workspaceId}-${r.year}-${String(r.month).padStart(2, "0")}-${r.currency}`,
              attempts: 8,
              backoff: { type: "exponential", delay: 30_000 },
              removeOnComplete: true,
              removeOnFail: false,
            },
          );
        }
      }
      return res;
    },
    { connection: { url: redisUrl } },
  );

  const originalClose = worker.close.bind(worker);
  worker.close = async () => {
    await originalClose();
    await rollupQueue.close();
  };

  return worker;
}
