import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../../tenancy/workspace-member.guard";
import { UsersService } from "../../users/users.service";
import { AuditService } from "../../audit/audit.service";
import { EmailCallbackDto } from "./dto/callback.dto";
import { EmailConnectUrlDto } from "./dto/connect-url.dto";
import { EmailSyncDto } from "./dto/sync.dto";
import { EmailIntegrationsService } from "./email-integrations.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/integrations/email")
@UseGuards(WorkspaceMemberGuard)
export class EmailIntegrationsController {
  constructor(
    private readonly users: UsersService,
    private readonly email: EmailIntegrationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    return this.email.list(workspaceId);
  }

  @Post(":provider/connect-url")
  async connectUrl(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("provider") provider: string,
    @Body() body: EmailConnectUrlDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.email.connectUrl(provider, body.redirectUri);
  }

  @Post(":provider/callback")
  async callback(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("provider") provider: string,
    @Body() body: EmailCallbackDto,
  ) {
    const user = await this.users.getOrCreateFromToken(req.user);
    return this.email.callback({ workspaceId, userId: user.id, provider, body });
  }

  @Post(":connectedId/sync")
  @HttpCode(200)
  async sync(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("connectedId") connectedId: string,
    @Body() body: EmailSyncDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    const jobId = await this.email.syncNow({ workspaceId, connectedId, mockMessages: body.mockMessages });
    return { queued: true, jobId };
  }

  @Delete(":connectedId")
  @HttpCode(200)
  async disconnect(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("connectedId") connectedId: string,
  ) {
    const actor = await this.users.getOrCreateFromToken(req.user);
    await this.email.disconnect(workspaceId, connectedId);
    await this.audit.logFromRequest(req, {
      action: "email_integration_disconnected",
      actorUserId: actor.id,
      actorEmail: actor.email,
      workspaceId,
      targetType: "ConnectedEmailAccount",
      targetId: connectedId,
    });
    return { disconnected: true };
  }
}
