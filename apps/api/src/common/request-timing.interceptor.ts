import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { Observable as RxObservable } from "rxjs";
import { runWithDatabaseTiming } from "@cinema/database";
import type { DatabaseTiming } from "@cinema/database";
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
    const databaseTiming: DatabaseTiming = { durationMs: 0, queryCount: 0 };
    const handled = new RxObservable<unknown>((subscriber) => runWithDatabaseTiming(
      databaseTiming,
      () => next.handle().subscribe(subscriber),
    ));
    return handled.pipe(finalize(() => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      if (!response.headersSent) response.setHeader(
        "Server-Timing",
        `app;dur=${durationMs.toFixed(1)}, db;dur=${databaseTiming.durationMs.toFixed(1)};desc="${databaseTiming.queryCount} queries"`,
      );
      if (durationMs >= SLOW_REQUEST_MS) {
        this.logger.warn("Slow API request", {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(durationMs),
          databaseDurationMs: Math.round(databaseTiming.durationMs),
          databaseQueryCount: databaseTiming.queryCount,
        });
      }
    }));
  }
}
