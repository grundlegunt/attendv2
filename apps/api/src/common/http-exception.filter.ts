import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { ApiErrorBody, ApiErrorCode } from "@cinema/shared";
import { AppError } from "./app-error";
import { StructuredLogger } from "./logger.service";
import { ErrorAlertReporter, redactedErrorDetails } from "./error-alert-reporter";

/**
 * Every error response, whether an intentional AppError, a NestJS built-in
 * HttpException, or an unexpected exception, is normalized to ApiErrorBody.
 * Unexpected exceptions are logged with full detail server-side but never
 * leak internals (stack traces, DB errors) to the client — see
 * SECURITY.md §6/§10.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new StructuredLogger(GlobalExceptionFilter.name);

  constructor(private readonly alerts = new ErrorAlertReporter()) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as Request & { requestId?: string }).requestId;

    if (exception instanceof AppError) {
      const body: ApiErrorBody = {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
      response.status(exception.getStatus()).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ApiErrorBody = {
        code: status === HttpStatus.NOT_FOUND ? ApiErrorCode.NotFound : ApiErrorCode.Internal,
        message: exception.message,
      };
      response.status(status).json(body);
      return;
    }

    const redacted = redactedErrorDetails(exception);
    const alert = {
      environment: process.env.NODE_ENV ?? "development",
      ...redacted,
      method: request.method,
      path: request.path,
      requestId,
      occurredAt: new Date().toISOString(),
    };
    this.logger.error("Unhandled exception", {
      requestId,
      error: redacted,
    });
    this.alerts.report(alert);

    const body: ApiErrorBody = {
      code: ApiErrorCode.Internal,
      message: "An unexpected error occurred.",
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
