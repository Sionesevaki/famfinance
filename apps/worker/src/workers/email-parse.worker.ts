import { Worker } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import type { PrismaClient } from "@famfinance/db";
import { S3Storage } from "../storage/s3";
import { processEmailParse, type EmailParsePayload } from "../processors/email-parse.processor";

export function createEmailParseWorker(params: { prisma: PrismaClient; s3: S3Storage }) {
  const redisUrl = requireEnv("REDIS_URL");
  return new Worker<EmailParsePayload>(
    "email_parse",
    async (job) => {
      return processEmailParse({ prisma: params.prisma, s3: params.s3, payload: job.data });
    },
    { connection: { url: redisUrl } },
  );
}

