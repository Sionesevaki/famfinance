import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { WorkspaceRole } from "@famfinance/db";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { WorkspaceRoles } from "../../tenancy/workspace-roles.decorator";
import { UsersService } from "../users/users.service";
import { AuditService } from "../audit/audit.service";
import { CreateInviteDto } from "./dto/create-invite.dto";
import { InvitesService } from "./invites.service";

type AuthedRequest = Request & { user: KeycloakToken; localUserId?: string };

@Controller("/workspaces/:workspaceId/invites")
@UseGuards(WorkspaceMemberGuard, WorkspaceRoleGuard)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class WorkspaceInvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateInviteDto,
  ) {
    const inviter = await this.users.getOrCreateFromToken(req.user);
    const invite = await this.invites.createInvite({
      workspaceId,
      invitedById: inviter.id,
      invitedEmail: body.email,
      role: body.role,
    });

    if (process.env.NODE_ENV === "test") {
      return { inviteId: invite.inviteId, expiresAt: invite.expiresAt, tokenForTestOnly: invite.tokenForTestOnly };
    }

    return { inviteId: invite.inviteId, expiresAt: invite.expiresAt };
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    return this.invites.listInvites(workspaceId);
  }

  @Post(":inviteId/revoke")
  @HttpCode(200)
  async revoke(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("inviteId") inviteId: string,
  ) {
    const actor = await this.users.getOrCreateFromToken(req.user);
    await this.invites.revokeInvite(workspaceId, inviteId);
    await this.audit.logFromRequest(req, {
      action: "workspace_invite_revoked",
      actorUserId: actor.id,
      actorEmail: actor.email,
      workspaceId,
      targetType: "WorkspaceInvite",
      targetId: inviteId,
    });
    return { revoked: true };
  }
}
