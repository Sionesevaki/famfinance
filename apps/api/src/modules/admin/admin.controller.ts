import { Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import type { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import type { RequestWithContext } from "../../common/http/request-context";
import { UsersService } from "../users/users.service";
import { AuditService } from "../audit/audit.service";
import { AdminService } from "./admin.service";
import { ListFailedJobsQuery } from "./dto/list-failed-jobs.query";
import { RetryJobQuery } from "./dto/retry-job.query";

type AuthedRequest = Request & RequestWithContext & { user: KeycloakToken };

@Controller("/admin")
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get("workspaces")
  async workspaces() {
    return this.admin.listWorkspaces();
  }

  @Get("users")
  async listUsers() {
    return this.admin.listUsers();
  }

  @Get("jobs/failed")
  async failedJobs(@Query() query: ListFailedJobsQuery) {
    return this.admin.listFailedJobs({ queue: query.queue, limit: query.limit, offset: query.offset });
  }

  @Post("jobs/:jobId/retry")
  @HttpCode(200)
  async retry(@Req() req: AuthedRequest, @Param("jobId") jobId: string, @Query() query: RetryJobQuery) {
    const actor = await this.users.getOrCreateFromToken(req.user);
    const res = await this.admin.retryJob({ queue: query.queue, jobId });
    await this.audit.logFromRequest(req, {
      action: "admin_job_retried",
      actorUserId: actor.id,
      actorEmail: actor.email,
      targetType: "BullMQJob",
      targetId: jobId,
      metadata: { queue: query.queue },
    });
    return res;
  }

  @Get("metrics")
  async metrics() {
    return this.admin.metrics();
  }

  @Get("metrics/prometheus")
  @Header("Content-Type", "text/plain; version=0.0.4")
  async metricsPrometheus() {
    return this.admin.metricsPrometheus();
  }
}
