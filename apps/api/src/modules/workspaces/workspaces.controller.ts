import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { UsersService } from "../users/users.service";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRole } from "@famfinance/db";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { WorkspacesService } from "./workspaces.service";

type AuthedRequest = Request & {
  user: KeycloakToken;
  localUserId?: string;
  workspaceMembership?: { role: WorkspaceRole };
};

@Controller()
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
  ) {}

  @Post("/workspaces")
  async create(@Req() req: AuthedRequest, @Body() body: CreateWorkspaceDto) {
    const user = await this.users.getOrCreateFromToken(req.user);
    const workspace = await this.workspaces.createWorkspace(user.id, body);
    return { workspaceId: workspace.id };
  }

  @Get("/workspaces")
  async list(@Req() req: AuthedRequest) {
    const user = await this.users.getOrCreateFromToken(req.user);
    return this.workspaces.listForUser(user.id);
  }

  @Get("/workspaces/:workspaceId")
  @UseGuards(WorkspaceMemberGuard)
  async get(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string) {
    await this.users.getOrCreateFromToken(req.user);
    const ws = await this.workspaces.getWorkspace(workspaceId);
    return { ...ws, role: req.workspaceMembership?.role };
  }

  @Patch("/workspaces/:workspaceId")
  @UseGuards(WorkspaceMemberGuard)
  async update(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Partial<CreateWorkspaceDto>,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    const membership = req.workspaceMembership;
    if (!membership) throw new Error("Missing membership in request context");
    return this.workspaces.updateWorkspace(workspaceId, membership.role, body);
  }
}
