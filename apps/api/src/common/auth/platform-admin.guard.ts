import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "./keycloak-jwt.guard";

type AuthedRequest = Request & { user?: KeycloakToken };

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const roles = req.user?.realm_access?.roles ?? [];
    if (roles.includes("platform_admin")) return true;
    throw new ForbiddenException("Requires platform_admin role");
  }
}

