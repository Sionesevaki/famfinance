import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersService } from "../users/users.service";
import { AnalyticsSummaryQuery } from "./dto/summary.query";
import { AnalyticsService } from "./analytics.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/analytics")
@UseGuards(WorkspaceMemberGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly users: UsersService,
  ) {}

  @Get("summary")
  async summary(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: AnalyticsSummaryQuery,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.analytics.summary({ workspaceId, month: query.month });
  }
}

