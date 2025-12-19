import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { WorkspaceRole } from "@famfinance/db";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { WorkspaceRoles } from "../../tenancy/workspace-roles.decorator";
import { UsersService } from "../users/users.service";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";
import { SubscriptionsService } from "./subscriptions.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/subscriptions")
@UseGuards(WorkspaceMemberGuard)
export class SubscriptionsController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    return this.subs.list(workspaceId);
  }

  @Post("detect")
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  @HttpCode(200)
  async detect(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    const jobId = await this.subs.enqueueDetect(workspaceId);
    return { queued: true, jobId };
  }

  @Patch(":subscriptionId")
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async update(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.subs.update(workspaceId, subscriptionId, body);
  }
}

