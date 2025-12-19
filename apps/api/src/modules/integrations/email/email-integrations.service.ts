import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { ProviderType } from "@famfinance/db";
import { Queue } from "bullmq";
import { requireEnv, encryptToBase64 } from "@famfinance/lib";
import { PrismaService } from "../../../prisma/prisma.service";
import type { EmailMockMessageDto } from "./dto/sync.dto";

@Injectable()
export class EmailIntegrationsService implements OnModuleDestroy {
  private readonly emailSyncQueue = new Queue("email_sync", { connection: { url: requireEnv("REDIS_URL") } });

  constructor(private readonly prisma: PrismaService) {}

  private requireAllowedRedirectUri(redirectUri: string) {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new BadRequestException("redirectUri must be a valid absolute URL");
    }

    const allowed = (process.env.OAUTH_ALLOWED_REDIRECT_URIS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowed.length === 0) {
      if (process.env.NODE_ENV === "production") {
        throw new BadRequestException("redirectUri allowlist is not configured");
      }
      return parsed.toString();
    }

    const normalized = parsed.toString();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException("redirectUri is not allowed");
    }
    return normalized;
  }

  async onModuleDestroy() {
    await this.emailSyncQueue.close();
  }

  async list(workspaceId: string) {
    const accounts = await this.prisma.connectedEmailAccount.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: { id: true, provider: true, providerEmail: true, status: true, createdAt: true, updatedAt: true, lastSyncAt: true },
    });

    return accounts.map((a) => ({
      connectedEmailAccountId: a.id,
      provider: a.provider,
      providerEmail: a.providerEmail,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      lastSyncAt: a.lastSyncAt,
    }));
  }

  async connectUrl(provider: string, redirectUri?: string) {
    // Placeholder: real OAuth URL generation is provider-specific and requires client ids/scopes.
    // We keep the endpoint shape stable and fail loudly when used without configuration.
    const p = provider.toLowerCase();
    if (p !== "gmail" && p !== "microsoft") throw new BadRequestException("Unsupported provider");
    if (!redirectUri) throw new BadRequestException("redirectUri is required");
    const normalizedRedirectUri = this.requireAllowedRedirectUri(redirectUri);
    return { url: `about:blank#provider=${encodeURIComponent(p)}&redirectUri=${encodeURIComponent(normalizedRedirectUri)}` };
  }

  async callback(params: {
    workspaceId: string;
    userId: string;
    provider: string;
    body: {
      providerEmail?: string;
      accessToken?: string;
      refreshToken?: string;
      tokenExpiresAt?: string;
      code?: string;
      redirectUri?: string;
    };
  }) {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("OAuth code exchange is not implemented yet for production");
    }

    const p = params.provider.toLowerCase();
    const providerType = p === "gmail" ? ProviderType.GMAIL : p === "microsoft" ? ProviderType.MICROSOFT : null;
    if (!providerType) throw new BadRequestException("Unsupported provider");

    if (params.body.code) {
      throw new BadRequestException("OAuth code exchange not implemented; provide tokens in non-production");
    }

    if (params.body.redirectUri) {
      this.requireAllowedRedirectUri(params.body.redirectUri);
    }

    const providerEmail = params.body.providerEmail?.trim().toLowerCase();
    if (!providerEmail) throw new BadRequestException("providerEmail is required");
    if (!params.body.accessToken) throw new BadRequestException("accessToken is required");

    const accessTokenEnc = encryptToBase64(params.body.accessToken);
    const refreshTokenEnc = params.body.refreshToken ? encryptToBase64(params.body.refreshToken) : null;
    const tokenExpiresAt = params.body.tokenExpiresAt ? new Date(params.body.tokenExpiresAt) : null;

    const account = await this.prisma.connectedEmailAccount.upsert({
      where: {
        provider_providerEmail_workspaceId: {
          provider: providerType,
          providerEmail,
          workspaceId: params.workspaceId,
        },
      },
      update: {
        userId: params.userId,
        status: "CONNECTED",
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
      },
      create: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        provider: providerType,
        providerEmail,
        status: "CONNECTED",
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
      },
      select: { id: true, status: true },
    });

    return { connectedEmailAccountId: account.id, status: account.status };
  }

  async syncNow(params: { workspaceId: string; connectedId: string; mockMessages?: EmailMockMessageDto[] }) {
    const connected = await this.prisma.connectedEmailAccount.findFirst({
      where: { id: params.connectedId, workspaceId: params.workspaceId },
      select: { id: true, status: true },
    });
    if (!connected) throw new NotFoundException("Connected email account not found");
    if (connected.status !== "CONNECTED") throw new BadRequestException("Email account is not connected");

    const allowMock = process.env.NODE_ENV === "test";
    const payload: { workspaceId: string; connectedId: string; mockMessages?: EmailMockMessageDto[] } = {
      workspaceId: params.workspaceId,
      connectedId: connected.id,
      ...(allowMock && params.mockMessages ? { mockMessages: params.mockMessages } : {}),
    };

    const job = await this.emailSyncQueue.add("email_sync", payload, {
      jobId: `email_sync-${connected.id}-${Date.now()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    await this.prisma.connectedEmailAccount.update({
      where: { id: connected.id },
      data: { lastSyncAt: new Date() },
    });

    return job.id;
  }

  async disconnect(workspaceId: string, connectedId: string) {
    const connected = await this.prisma.connectedEmailAccount.findFirst({
      where: { id: connectedId, workspaceId },
      select: { id: true },
    });
    if (!connected) throw new NotFoundException("Connected email account not found");

    await this.prisma.connectedEmailAccount.update({
      where: { id: connected.id },
      data: { status: "REVOKED", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null },
    });
  }
}
