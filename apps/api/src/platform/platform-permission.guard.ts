import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { AppError } from "../common/app-error";
import { PLATFORM_PERMISSION_METADATA } from "./platform-permissions";

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<string>(PLATFORM_PERMISSION_METADATA, [context.getHandler(), context.getClass()]);
    if (!permission) return true;
    const actor = context.switchToHttp().getRequest<Request>().actor;
    if (!actor?.permissions.includes(permission)) throw AppError.forbidden("Your Attend Master role does not allow this action.");
    return true;
  }
}
