import type { PrismaClient } from "@famfinance/db";
import { Queue } from "bullmq";
import { requireEnv } from "@famfinance/lib";

export type EmailAttachmentPayload = {
  filename: string;
  mimeType: string;
  bodyBase64: string;
};

export type EmailMockMessagePayload = {
  providerMsgId: string;
  subject?: string;
  fromEmail?: string;
  sentAt?: string;
  snippet?: string;
  sha256?: string;
  attachments: EmailAttachmentPayload[];
};

export type EmailSyncPayload = {
  workspaceId: string;
  connectedId: string;
  mockMessages?: EmailMockMessagePayload[];
};

export async function processEmailSync(params: { prisma: PrismaClient; payload: EmailSyncPayload }) {
  const { prisma, payload } = params;
  const parseQueue = new Queue("email_parse", { connection: { url: requireEnv("REDIS_URL") } });

  try {
    const connected = await prisma.connectedEmailAccount.findFirst({
      where: { id: payload.connectedId, workspaceId: payload.workspaceId },
      select: { id: true, status: true },
    });
    if (!connected) throw new Error("Connected email account not found");
    if (connected.status !== "CONNECTED") throw new Error("Connected email account not in CONNECTED status");

    if (!payload.mockMessages) {
      throw new Error("Provider fetching not implemented (missing mockMessages)");
    }

    for (const msg of payload.mockMessages) {
      const email = await prisma.emailMessage.upsert({
        where: { connectedId_providerMsgId: { connectedId: payload.connectedId, providerMsgId: msg.providerMsgId } },
        update: {
          subject: msg.subject ?? null,
          fromEmail: msg.fromEmail ?? null,
          sentAt: msg.sentAt ? new Date(msg.sentAt) : null,
          snippet: msg.snippet ?? null,
          sha256: msg.sha256 ?? null,
        },
        create: {
          workspaceId: payload.workspaceId,
          connectedId: payload.connectedId,
          providerMsgId: msg.providerMsgId,
          subject: msg.subject ?? null,
          fromEmail: msg.fromEmail ?? null,
          sentAt: msg.sentAt ? new Date(msg.sentAt) : null,
          snippet: msg.snippet ?? null,
          sha256: msg.sha256 ?? null,
        },
        select: { id: true },
      });

      await parseQueue.add(
        "email_parse",
        {
          workspaceId: payload.workspaceId,
          connectedId: payload.connectedId,
          providerMsgId: msg.providerMsgId,
          emailMessageId: email.id,
          attachments: msg.attachments,
        },
        {
          jobId: `email_parse-${payload.connectedId}-${msg.providerMsgId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }

    return { status: "enqueued_parse", count: payload.mockMessages.length };
  } finally {
    await parseQueue.close();
  }
}

