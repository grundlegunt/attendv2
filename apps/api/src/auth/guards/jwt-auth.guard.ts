import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { InvalidTokenError, verifyAccessToken } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { AppError } from "../../common/app-error";

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * decoded payload to `request.actor`. This is the *only* mechanism by
 * which a request is considered authenticated — per AGENTS.md §5, this
 * check happens server-side on every guarded route, never inferred from
 * anything client-supplied beyond the token itself.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      throw AppError.unauthenticated();
    }

    const token = header.slice("Bearer ".length);
    const env = loadEnv();

    try {
      request.actor = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw AppError.unauthenticated("Session expired or invalid. Please log in again.");
      }
      throw err;
    }

    return true;
  }
}
