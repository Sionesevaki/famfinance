import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import type { RequestWithContext } from "../../common/http/request-context";

type AuditEvent = {
  action: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logFromRequest(req: Request & RequestWithContext, event: AuditEvent) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim() || req.ip || null;
    const userAgentHeader = req.headers["user-agent"];
    const userAgent = (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader) || null;

    await this.prisma.auditLog.create({
      data: {
        action: event.action,
        actorUserId: event.actorUserId ?? null,
        actorEmail: event.actorEmail ?? null,
        workspaceId: event.workspaceId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        requestId: req.requestId ?? null,
        ip: ip ? String(ip).slice(0, 200) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
        metadata: event.metadata ?? undefined,
      },
    });
  }
}

