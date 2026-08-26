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
      if (actor.supportSession && isUnsafeMethod(request.method)) {
        throw AppError.forbidden("Ringo support sessions are read-only.");
      }
      if (actor.actorType === "EMPLOYEE") {
        if (!actor.locationId) throw AppError.unauthenticated("Staff session is invalid.");
        if (actor.supportSession) {
          const location = await prisma.location.findUnique({
            where: { id: actor.locationId },
            select: { active: true, organization: { select: { active: true } } },
          });
          if (!location?.active || !location.organization.active) throw AppError.unauthenticated("This cinema account is currently inactive.");
          request.actor = actor;
          return true;
        }
        if (!Number.isInteger(actor.tokenVersion)) throw AppError.unauthenticated("Staff session is invalid.");
        const employee = await prisma.employee.findUnique({
          where: { id: actor.sub },
          select: {
            active: true,
            locationId: true,
            location: { select: { organization: { select: { active: true } } } },
            authAccount: { select: { refreshTokenVersion: true } },
          },
        });
        if (!employee?.active || employee.locationId !== actor.locationId || !employee.location.organization.active) {
          throw AppError.unauthenticated("This staff account is currently inactive.");
        }
        if (!employee.authAccount || employee.authAccount.refreshTokenVersion !== actor.tokenVersion) {
          throw AppError.unauthenticated("Session has been invalidated. Please log in again.");
        }
      } else if (actor.actorType === "CUSTOMER") {
        if (!Number.isInteger(actor.tokenVersion)) throw AppError.unauthenticated();
        const account = await prisma.customerAuthAccount.findUnique({
          where: { customerId: actor.sub },
          select: { emailVerifiedAt: true, refreshTokenVersion: true },
        });
        if (!account?.emailVerifiedAt || account.refreshTokenVersion !== actor.tokenVersion) {
          throw AppError.unauthenticated("Session has been invalidated. Please log in again.");
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
