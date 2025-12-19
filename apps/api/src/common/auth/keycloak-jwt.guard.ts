import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { requireEnv } from "@famfinance/lib";
import jwt, {
  type JwtHeader,
  type JwtPayload,
  type SigningKeyCallback,
  type VerifyErrors,
} from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

export type KeycloakToken = JwtPayload & {
  email?: string;
  name?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
};

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  private readonly jwks = jwksRsa({
    jwksUri: requireEnv("KEYCLOAK_JWKS_URI"),
    cache: true,
    cacheMaxEntries: 10,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  private readonly issuer = requireEnv("KEYCLOAK_ISSUER");
  private readonly audience = requireEnv("KEYCLOAK_AUDIENCE");

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers["authorization"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = auth.slice("Bearer ".length);
    try {
      const payload = await new Promise<KeycloakToken>((resolve, reject) => {
        jwt.verify(
          token,
          (header: JwtHeader, cb: SigningKeyCallback) => {
            if (!header.kid) return cb(new Error("Missing kid"));
            this.jwks.getSigningKey(header.kid, (err, key) => {
              if (err || !key) return cb(err || new Error("Missing signing key"));
              cb(null, key.getPublicKey());
            });
          },
          {
            issuer: this.issuer,
            audience: this.audience,
            algorithms: ["RS256"],
          },
          (err: VerifyErrors | null, decoded: unknown) => {
            if (err || !decoded || typeof decoded === "string") return reject(err ?? new Error("Bad token"));
            resolve(decoded as KeycloakToken);
          },
        );
      });

      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }
}
