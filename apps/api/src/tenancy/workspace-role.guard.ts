import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WorkspaceRole } from "@famfinance/db";
import { WORKSPACE_ROLES_KEY } from "./workspace-roles.decorator";
import { Request } from "express";

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(WORKSPACE_ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { workspaceMembership?: { role?: WorkspaceRole } }>();
    const role = req.workspaceMembership?.role;

    if (!role) throw new ForbiddenException("Not a workspace member");
    if (!requiredRoles.includes(role)) throw new ForbiddenException("Insufficient role");

    return true;
  }
}
