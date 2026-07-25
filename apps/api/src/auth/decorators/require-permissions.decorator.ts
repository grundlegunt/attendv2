import { SetMetadata } from "@nestjs/common";
import { Permission } from "@cinema/auth";

export const PERMISSIONS_METADATA_KEY = "requiredPermissions";

/**
 * Declares the permission(s) required to call this handler. Combined with
 * PermissionsGuard, this is the server-side enforcement mechanism AGENTS.md
 * §5 requires on every state-changing endpoint — never rely on the
 * frontend hiding a button.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
