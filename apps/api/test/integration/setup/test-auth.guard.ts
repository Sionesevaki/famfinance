import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();

    req.user = {
      sub: req.headers["x-test-sub"] || "sub-user-1",
      email: req.headers["x-test-email"] || "user1@example.com",
      realm_access: {
        roles: String(req.headers["x-test-roles"] || "")
          .split(",")
          .filter(Boolean),
      },
    };

    return true;
  }
}

