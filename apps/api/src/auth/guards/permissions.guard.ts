import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Permission } from "@cinema/auth";
import { AppError } from "../../common/app-error";
import { PERMISSIONS_METADATA_KEY } from "../decorators/require-permissions.decorator";

/**
 * Must run after JwtAuthGuard (relies on `request.actor` being populated).
 * Checks the actor's flattened permission set against the permissions
 * declared via @RequirePermissions on the handler. A missing permission is
 * a 403, not a hidden button — see AGENTS.md §5, SECURITY.md §2.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.actor;

    if (!actor) {
      // Guard misconfiguration (PermissionsGuard used without JwtAuthGuard)
      // should fail closed, not open.
      throw AppError.unauthenticated();
    }

    const granted = new Set(actor.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw AppError.forbidden(
        `Missing required permission(s): ${missing.join(", ")}.`,
      );
    }

    return true;
  }
}
