import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import type { Request, Response } from "express";
import type { RequestWithContext } from "./request-context";

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & RequestWithContext>();
    const res = http.getResponse<Response>();

    const headerValue = req.headers["x-request-id"];
    const inbound = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const requestId = (inbound && String(inbound).slice(0, 200)) || randomUUID();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    return next.handle();
  }
}

