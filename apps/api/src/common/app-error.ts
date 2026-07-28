import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiErrorCode } from "@cinema/shared";

/**
 * Canonical application error. Every intentional rejection (bad input, auth
 * failure, permission denial, conflict) should throw this, not a bare
 * NestJS HttpException, so the response body always matches ApiErrorBody
 * from @cinema/shared. See AGENTS.md §2 — errors are never swallowed, and
 * every rejection carries a stable machine-readable `code`.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static validationFailed(message: string, details?: Record<string, unknown>) {
    return new AppError(ApiErrorCode.ValidationFailed, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthenticated(message = "Authentication required.") {
    return new AppError(ApiErrorCode.Unauthenticated, message, HttpStatus.UNAUTHORIZED);
  }

  static invalidCredentials(message = "Invalid email or password.") {
    return new AppError(ApiErrorCode.InvalidCredentials, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = "You do not have permission to perform this action.") {
    return new AppError(ApiErrorCode.Forbidden, message, HttpStatus.FORBIDDEN);
  }

  static notFound(message = "Resource not found.") {
    return new AppError(ApiErrorCode.NotFound, message, HttpStatus.NOT_FOUND);
  }

  static conflict(message: string, details?: Record<string, unknown>) {
    return new AppError(ApiErrorCode.Conflict, message, HttpStatus.CONFLICT, details);
  }

  static paymentRequired(message: string) {
    return new AppError(
      ApiErrorCode.PaymentNotSucceeded,
      message,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
