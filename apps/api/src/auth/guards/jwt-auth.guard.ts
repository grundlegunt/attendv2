import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { InvalidTokenError, verifyAccessToken } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { prisma } from "@cinema/database";
import { AppError } from "../../common/app-error";
import {
  assertTrustedCustomerOrigin,
  CUSTOMER_ACCESS_COOKIE,
  isUnsafeMethod,
  readCookie,
} from "../customer-session";

/**
 * Verifies staff bearer tokens or the customer's HttpOnly access-token
 * cookie and attaches the decoded payload to `request.actor`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    const cookieToken = bearerToken ? undefined : readCookie(request, CUSTOMER_ACCESS_COOKIE);
    const token = bearerToken ?? cookieToken;
    if (!token) throw AppError.unauthenticated();

    if (cookieToken && isUnsafeMethod(request.method)) {
      assertTrustedCustomerOrigin(request);
    }
    const env = loadEnv();

    try {
      const actor = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      if (cookieToken && actor.actorType !== "CUSTOMER") throw AppError.unauthenticated();
      if (actor.actorType === "EMPLOYEE") {
        if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
        const location = await prisma.location.findUnique({
          where: { id: actor.locationId },
          select: { organization: { select: { active: true } } },
        });
        if (!location?.organization.active) {
          throw AppError.unauthenticated("This cinema account is currently inactive.");
        }
      }
      request.actor = actor;
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw AppError.unauthenticated("Session expired or invalid. Please log in again.");
      }
      throw err;
    }

    return true;
  }
}
