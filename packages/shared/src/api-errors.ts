/**
 * Standard error response shape returned by every API endpoint. Frontends
 * key error handling off `code`, not the human-readable `message` (which
 * may change wording without notice).
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const ApiErrorCode = {
  ValidationFailed: "VALIDATION_FAILED",
  Unauthenticated: "UNAUTHENTICATED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  InvalidCredentials: "INVALID_CREDENTIALS",
  RateLimited: "RATE_LIMITED",
  Internal: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
