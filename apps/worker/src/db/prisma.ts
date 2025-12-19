import { PrismaClient } from "@famfinance/db";

export function createWorkerPrismaClient(): PrismaClient {
  return new PrismaClient();
}

