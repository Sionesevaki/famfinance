import { Controller, Delete, Get, Param, Patch, Body, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { WorkspaceRole } from "@famfinance/db";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { WorkspaceRoles } from "../../tenancy/workspace-roles.decorator";
import { UsersService } from "../users/users.service";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { WorkspacesService } from "./workspaces.service";

type AuthedRequest = Request & {
  user: KeycloakToken;
  localUserId?: string;
  workspaceMembership?: { id: string; role: WorkspaceRole; userId: string; workspaceId: string };
};

@Controller("/workspaces/:workspaceId/members")
@UseGuards(WorkspaceMemberGuard)
export class WorkspaceMembersController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    return this.workspaces.listMembers(workspaceId);
  }

  @Patch(":memberId")
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles(WorkspaceRole.OWNER)
  async updateRole(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateMemberRoleDto,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.workspaces.updateMemberRole(workspaceId, memberId, body.role);
  }

  @Delete(":memberId")
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async remove(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    const requester = req.workspaceMembership!;
    await this.workspaces.removeMember(workspaceId, memberId, requester);
    return { removed: true };
  }
}

