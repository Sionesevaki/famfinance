import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../common/auth/keycloak-jwt.guard";
import { UsersService } from "../modules/users/users.service";
import { WorkspacesService } from "../modules/workspaces/workspaces.service";

type AuthedRequest = Request & {
  user: KeycloakToken;
  localUserId?: string;
  workspaceMembership?: unknown;
};

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const workspaceId = req.params["workspaceId"];
    if (!workspaceId) return true;

    const user = await this.users.getOrCreateFromToken(req.user);
    const membership = await this.workspaces.requireMembership(user.id, workspaceId);

    req.localUserId = user.id;
    req.workspaceMembership = membership;
    return true;
  }
}
