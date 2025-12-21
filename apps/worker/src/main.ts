import { createWorkerPrismaClient } from "./db/prisma";
import { S3Storage } from "./storage/s3";
import { createDocExtractWorker } from "./workers/doc-extract.worker";
import { createNormalizeWorker } from "./workers/normalize.worker";
import { createTxUpsertWorker } from "./workers/tx-upsert.worker";
import { createRollupMonthlyWorker } from "./workers/rollup-monthly.worker";
import { createSubscriptionDetectWorker } from "./workers/subscription-detect.worker";
import { createEmailSyncWorker } from "./workers/email-sync.worker";
import { createEmailParseWorker } from "./workers/email-parse.worker";
import type { Worker } from "bullmq";

type JobLike = { id?: string | number };

function getJobId(job: JobLike | undefined | null): string {
  const id = job?.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return "unknown";
}

function attachWorkerLogs<DataType, ResultType, NameType extends string>(
  queue: string,
  worker: Worker<DataType, ResultType, NameType>,
) {
  worker.on("active", (job) => {
    console.log(`[${queue}] started job ${getJobId(job)}`);
  });
  worker.on("completed", (job) => {
    console.log(`[${queue}] completed job ${getJobId(job)}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[${queue}] failed job ${getJobId(job)}:`, err);
  });
  worker.on("error", (err) => {
    console.error(`[${queue}] worker error:`, err);
  });
}

async function main() {
  const prisma = createWorkerPrismaClient();
  await prisma.$connect();

  const s3 = new S3Storage();
  const docExtractWorker = createDocExtractWorker({ prisma, s3 });
  const emailSyncWorker = createEmailSyncWorker({ prisma });
  const emailParseWorker = createEmailParseWorker({ prisma, s3 });
  const normalizeWorker = createNormalizeWorker({ prisma });
  const txUpsertWorker = createTxUpsertWorker({ prisma });
  const rollupMonthlyWorker = createRollupMonthlyWorker({ prisma });
  const subscriptionDetectWorker = createSubscriptionDetectWorker({ prisma });

  attachWorkerLogs("email_sync", emailSyncWorker);
  attachWorkerLogs("email_parse", emailParseWorker);
  attachWorkerLogs("doc_extract", docExtractWorker);
  attachWorkerLogs("normalize", normalizeWorker);
  attachWorkerLogs("tx_upsert", txUpsertWorker);
  attachWorkerLogs("rollup_monthly", rollupMonthlyWorker);
  attachWorkerLogs("subscription_detect", subscriptionDetectWorker);

  console.log(
    "worker started (queues: email_sync, email_parse, doc_extract, normalize, tx_upsert, rollup_monthly, subscription_detect)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
