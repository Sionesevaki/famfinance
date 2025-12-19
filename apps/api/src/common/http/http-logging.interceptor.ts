import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import type { Request, Response } from "express";
import type { RequestWithContext } from "./request-context";

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (process.env.NODE_ENV === "test") return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & RequestWithContext>();
    const res = http.getResponse<Response>();

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.log(req, res, start);
        },
        error: () => {
          this.log(req, res, start);
        },
      }),
    );
  }

  private log(req: RequestWithContext, res: Response, startMs: number) {
    const durationMs = Date.now() - startMs;
    const statusCode = res.statusCode;

    const entry = {
      level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
      msg: "http_request",
      requestId: req.requestId ?? null,
      method: req.method,
      path: (req.originalUrl || req.url || "").split("?")[0],
      statusCode,
      durationMs,
    };

    const line = JSON.stringify(entry);
    if (entry.level === "error") console.error(line);
    else if (entry.level === "warn") console.warn(line);
    else console.log(line);
  }
}

