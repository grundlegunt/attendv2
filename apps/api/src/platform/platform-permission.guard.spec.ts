import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PlatformPermissionGuard } from "./platform-permission.guard";
import { PLATFORM_WRITE_PERMISSION } from "./platform-permissions";

function context(permissions: string[]) {
  return { switchToHttp: () => ({ getRequest: () => ({ actor: { permissions } }) }), getHandler: () => undefined, getClass: () => undefined } as unknown as ExecutionContext;
}

describe("PlatformPermissionGuard", () => {
  it("accepts a platform actor with the required permission", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(PLATFORM_WRITE_PERMISSION) } as unknown as Reflector;
    expect(new PlatformPermissionGuard(reflector).canActivate(context([PLATFORM_WRITE_PERMISSION]))).toBe(true);
  });

  it("rejects a platform actor without the required permission", () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(PLATFORM_WRITE_PERMISSION) } as unknown as Reflector;
    expect(() => new PlatformPermissionGuard(reflector).canActivate(context([]))).toThrow("Your Attend Master role does not allow this action.");
  });
});
