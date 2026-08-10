import { SetMetadata } from "@nestjs/common";
import { PlatformUserRole } from "@cinema/database";

export const PLATFORM_WRITE_PERMISSION = "platform:write";
export const PLATFORM_TEAM_PERMISSION = "platform:team";
export const PLATFORM_PERMISSION_METADATA = "platform-permission";

export const RequirePlatformPermission = (permission: string) => SetMetadata(PLATFORM_PERMISSION_METADATA, permission);

export function permissionsForPlatformRole(role: PlatformUserRole): string[] {
  if (role === PlatformUserRole.OWNER) return [PLATFORM_WRITE_PERMISSION, PLATFORM_TEAM_PERMISSION];
  if (role === PlatformUserRole.OPERATOR) return [PLATFORM_WRITE_PERMISSION];
  return [];
}
