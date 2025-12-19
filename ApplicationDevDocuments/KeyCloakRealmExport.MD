Keycloak realm export JSON

Save as: infra/docker/keycloak/realm-export.json

This creates:

Realm: family-finance

Clients: web, admin, mobile (public + PKCE), api (confidential)

Realm role: platform_admin

Client Scope: api-audience that injects aud: "api" into access tokens for web/admin/mobile

Note: Keycloak export formats vary slightly by version. This works for modern Keycloak (17+). If your UI names differ, import still succeeds and you can adjust toggles in the Admin Console.

{
  "realm": "family-finance",
  "enabled": true,

  "registrationAllowed": true,
  "rememberMe": true,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,

  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 28800,
  "ssoSessionMaxLifespan": 604800,

  "bruteForceProtected": true,
  "failureFactor": 5,
  "maxFailureWaitSeconds": 900,
  "waitIncrementSeconds": 60,
  "quickLoginCheckMilliSeconds": 1000,
  "minimumQuickLoginWaitSeconds": 60,

  "roles": {
    "realm": [
      { "name": "platform_admin", "description": "Platform admin for admin frontend" }
    ]
  },

  "clientScopes": [
    {
      "name": "api-audience",
      "description": "Adds api as audience to access tokens",
      "protocol": "openid-connect",
      "attributes": {
        "include.in.token.scope": "false",
        "display.on.consent.screen": "false"
      },
      "protocolMappers": [
        {
          "name": "aud-api",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "consentRequired": false,
          "config": {
            "included.client.audience": "api",
            "id.token.claim": "false",
            "access.token.claim": "true"
          }
        }
      ]
    }
  ],

  "clients": [
    {
      "clientId": "api",
      "name": "api",
      "protocol": "openid-connect",
      "publicClient": false,
      "bearerOnly": false,
      "standardFlowEnabled": false,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": false,
      "authorizationServicesEnabled": false,
      "secret": "REPLACE_ME_API_CLIENT_SECRET",
      "enabled": true
    },
    {
      "clientId": "web",
      "name": "web",
      "protocol": "openid-connect",
      "publicClient": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "enabled": true,
      "redirectUris": ["http://localhost:3000/*"],
      "webOrigins": ["http://localhost:3000"],
      "attributes": {
        "pkce.code.challenge.method": "S256"
      },
      "defaultClientScopes": ["profile", "email", "roles", "api-audience"]
    },
    {
      "clientId": "admin",
      "name": "admin",
      "protocol": "openid-connect",
      "publicClient": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "enabled": true,
      "redirectUris": ["http://localhost:3001/*"],
      "webOrigins": ["http://localhost:3001"],
      "attributes": {
        "pkce.code.challenge.method": "S256"
      },
      "defaultClientScopes": ["profile", "email", "roles", "api-audience"]
    },
    {
      "clientId": "mobile",
      "name": "mobile",
      "protocol": "openid-connect",
      "publicClient": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "enabled": true,
      "redirectUris": ["com.yourapp://*", "exp://*", "https://auth.expo.io/*"],
      "attributes": {
        "pkce.code.challenge.method": "S256"
      },
      "defaultClientScopes": ["profile", "email", "roles", "api-audience"]
    }
  ]
}

Docker compose snippet (Keycloak import)

In infra/docker/docker-compose.yml:

services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command:
      - start-dev
      - --import-realm
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
    volumes:
      - ./keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json:ro


After startup, log into Admin Console:

http://localhost:8080

Realm should exist: family-finance

Update the api client secret in the UI (or edit JSON) if you want something secure.

2) NestJS JWT validation (issuer + JWKS + audience + roles)
Install deps (apps/api)
pnpm add jose

Env variables (apps/api)
KEYCLOAK_ISSUER=http://localhost:8080/realms/family-finance
KEYCLOAK_JWKS_URI=http://localhost:8080/realms/family-finance/protocol/openid-connect/certs
KEYCLOAK_AUDIENCE=api

Create a Keycloak JWT guard using jose

This avoids passport/JWKS-rsa complexity and is very reliable.

apps/api/src/common/guards/keycloak-jwt.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export type KeycloakToken = JWTPayload & {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
};

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  private jwks = createRemoteJWKSet(new URL(process.env.KEYCLOAK_JWKS_URI!));
  private issuer = process.env.KEYCLOAK_ISSUER!;
  private audience = process.env.KEYCLOAK_AUDIENCE!;

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    const auth = req.headers["authorization"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token");

    const token = auth.slice("Bearer ".length);

    try {
      const { payload } = await jwtVerify<KeycloakToken>(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });

      // Attach to request for downstream usage
      req.user = payload;
      return true;
    } catch (e) {
      throw new UnauthorizedException("Invalid token");
    }
  }
}

Apply guard globally (recommended)

apps/api/src/main.ts:

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { KeycloakJwtGuard } from "./common/guards/keycloak-jwt.guard";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  });

  // Global guard (or apply per-controller)
  app.useGlobalGuards(new KeycloakJwtGuard());

  await app.listen(4000);
}
bootstrap();


If you need some public routes (health, auth callback), mark them with a @Public() decorator and bypass the guard (I can give that snippet too).

Role guard for platform_admin
apps/api/src/common/guards/roles.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";

export const ROLES_KEY = "roles";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const requiredRoles: string[] = Reflect.getMetadata(ROLES_KEY, ctx.getHandler()) ?? [];
    if (requiredRoles.length === 0) return true;

    const user = req.user as any;
    const roles: string[] = user?.realm_access?.roles ?? [];

    const has = requiredRoles.every((r) => roles.includes(r));
    if (!has) throw new ForbiddenException("Insufficient role");

    return true;
  }
}


Usage in an admin controller:

import { Controller, Get, UseGuards } from "@nestjs/common";
import { Roles, RolesGuard } from "../common/guards/roles.guard";

@Controller("/admin")
@UseGuards(RolesGuard)
export class AdminController {
  @Get("/stats")
  @Roles("platform_admin")
  stats() {
    return { ok: true };
  }
}

Workspace authorization (DB-based)

You’ll use req.user.sub to resolve your User record and then verify membership in Prisma:

User.keycloakSub === sub

WorkspaceMember(workspaceId, userId) exists

role checks based on WorkspaceMember.role

(If you want, I’ll provide a @WorkspaceRole() decorator + guard next.)