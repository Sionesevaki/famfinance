import { createWorkerPrismaClient } from "./db/prisma";
import { S3Storage } from "./storage/s3";
import { createDocExtractWorker } from "./workers/doc-extract.worker";
import { createNormalizeWorker } from "./workers/normalize.worker";
import { createTxUpsertWorker } from "./workers/tx-upsert.worker";
import { createRollupMonthlyWorker } from "./workers/rollup-monthly.worker";
import { createSubscriptionDetectWorker } from "./workers/subscription-detect.worker";
import { createEmailSyncWorker } from "./workers/email-sync.worker";
import { createEmailParseWorker } from "./workers/email-parse.worker";

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

  emailSyncWorker.on("completed", (job) => {
    console.log(`[email_sync] completed job ${job.id}`);
  });
  emailSyncWorker.on("failed", (job, err) => {
    console.error(`[email_sync] failed job ${job?.id}:`, err);
  });

  emailParseWorker.on("completed", (job) => {
    console.log(`[email_parse] completed job ${job.id}`);
  });
  emailParseWorker.on("failed", (job, err) => {
    console.error(`[email_parse] failed job ${job?.id}:`, err);
  });

  docExtractWorker.on("completed", (job) => {
    console.log(`[doc_extract] completed job ${job.id}`);
  });
  docExtractWorker.on("failed", (job, err) => {
    console.error(`[doc_extract] failed job ${job?.id}:`, err);
  });

  normalizeWorker.on("completed", (job) => {
    console.log(`[normalize] completed job ${job.id}`);
  });
  normalizeWorker.on("failed", (job, err) => {
    console.error(`[normalize] failed job ${job?.id}:`, err);
  });

  txUpsertWorker.on("completed", (job) => {
    console.log(`[tx_upsert] completed job ${job.id}`);
  });
  txUpsertWorker.on("failed", (job, err) => {
    console.error(`[tx_upsert] failed job ${job?.id}:`, err);
  });

  rollupMonthlyWorker.on("completed", (job) => {
    console.log(`[rollup_monthly] completed job ${job.id}`);
  });
  rollupMonthlyWorker.on("failed", (job, err) => {
    console.error(`[rollup_monthly] failed job ${job?.id}:`, err);
  });

  subscriptionDetectWorker.on("completed", (job) => {
    console.log(`[subscription_detect] completed job ${job.id}`);
  });
  subscriptionDetectWorker.on("failed", (job, err) => {
    console.error(`[subscription_detect] failed job ${job?.id}:`, err);
  });

  console.log(
    "worker started (queues: email_sync, email_parse, doc_extract, normalize, tx_upsert, rollup_monthly, subscription_detect)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
