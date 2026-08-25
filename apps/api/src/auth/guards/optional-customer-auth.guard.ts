import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Request } from "express";
import { AppError } from "../../common/app-error";
import { CUSTOMER_ACCESS_COOKIE, readCookie } from "../customer-session";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Authenticates a customer cookie when one is present, while preserving guest
 * checkout when no customer session exists. Invalid cookies fail closed.
 */
@Injectable()
export class OptionalCustomerAuthGuard implements CanActivate {
  constructor(private readonly jwtAuthGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!readCookie(request, CUSTOMER_ACCESS_COOKIE)) return true;
    await this.jwtAuthGuard.canActivate(context);
    if (request.actor?.actorType !== "CUSTOMER") throw AppError.unauthenticated();
    return true;
  }
}
