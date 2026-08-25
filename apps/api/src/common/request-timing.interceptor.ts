import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { StructuredLogger } from "./logger.service";

const SLOW_REQUEST_MS = 750;

/** Exposes API duration in DevTools and emits structured slow-request logs. */
@Injectable()
export class RequestTimingInterceptor implements NestInterceptor {
  private readonly logger = new StructuredLogger("RequestTiming");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    return next.handle().pipe(finalize(() => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      if (!response.headersSent) response.setHeader("Server-Timing", `app;dur=${durationMs.toFixed(1)}`);
      if (durationMs >= SLOW_REQUEST_MS) {
        this.logger.warn("Slow API request", {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(durationMs),
        });
      }
    }));
  }
}
