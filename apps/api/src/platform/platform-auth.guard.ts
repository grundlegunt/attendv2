import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { InvalidTokenError, verifyAccessToken } from "@cinema/auth";
import { loadEnv } from "@cinema/config/env";
import { prisma } from "@cinema/database";
import { AppError } from "../common/app-error";

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw AppError.unauthenticated();

    try {
      const actor = verifyAccessToken(header.slice("Bearer ".length), loadEnv().JWT_ACCESS_SECRET);
      if (actor.actorType !== "PLATFORM") throw AppError.forbidden("Attend platform access is required.");
      if (!Number.isInteger(actor.tokenVersion)) throw AppError.unauthenticated("Attend platform session is invalid.");
      const user = await prisma.platformUser.findUnique({
        where: { id: actor.sub },
        select: { active: true, refreshTokenVersion: true },
      });
      if (!user?.active || user.refreshTokenVersion !== actor.tokenVersion) {
        throw AppError.unauthenticated("The Attend platform session is no longer valid. Please sign in again.");
      }
      request.actor = actor;
      return true;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw AppError.unauthenticated("Session expired or invalid. Please log in again.");
      }
      throw error;
    }
  }
}
