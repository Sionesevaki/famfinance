import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { RATE_LIMIT_KEY, type RateLimitConfig } from "./rate-limit.decorator";

type Counter = { count: number; resetAt: number };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const config = this.reflector.getAllAndOverride<RateLimitConfig | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!config) return true;

    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const now = Date.now();
    const identifier = this.getIdentifier(req);
    const key = `${config.key}:${identifier}`;

    const existing = this.counters.get(key);
    const counter = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + config.windowMs };
    counter.count += 1;
    this.counters.set(key, counter);

    const remaining = Math.max(config.max - counter.count, 0);
    res.setHeader("x-ratelimit-limit", String(config.max));
    res.setHeader("x-ratelimit-remaining", String(remaining));
    res.setHeader("x-ratelimit-reset", String(Math.ceil(counter.resetAt / 1000)));

    if (counter.count > config.max) {
      const retryAfterSeconds = Math.max(0, Math.ceil((counter.resetAt - now) / 1000));
      res.setHeader("retry-after", String(retryAfterSeconds));
      throw new HttpException("Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private getIdentifier(req: Request): string {
    const header = req.headers["x-forwarded-for"];
    const forwardedFor = Array.isArray(header) ? header[0] : header;
    if (forwardedFor) return String(forwardedFor).split(",")[0].trim().slice(0, 200);
    const ip = (req.ip || "").trim();
    return ip ? ip.slice(0, 200) : "unknown";
  }
}
