import { ExecutionContext } from "@nestjs/common";
import { signTokenPair } from "@cinema/auth";
import { __resetEnvCacheForTests } from "@cinema/config/env";
import { prisma } from "@cinema/database";
import { PlatformAuthGuard } from "./platform-auth.guard";

const accessSecret = "platform-access-secret-for-unit-tests";

jest.mock("@cinema/database", () => ({
  prisma: { platformUser: { findUnique: jest.fn() } },
}));

const mockPlatformUserFindUnique = prisma.platformUser.findUnique as jest.Mock;

function token(actorType: "PLATFORM" | "EMPLOYEE") {
  return signTokenPair(
    { sub: `${actorType.toLowerCase()}-1`, actorType, tokenVersion: 0, permissions: [] },
    { sub: `${actorType.toLowerCase()}-1`, actorType, tokenVersion: 0 },
    { accessSecret, refreshSecret: "platform-refresh-secret-for-tests", accessTtlSeconds: 900, refreshTtlSeconds: 900 },
  ).accessToken;
}

function context(authorization?: string) {
  const request: { headers: { authorization?: string }; actor?: unknown } = { headers: {} };
  if (authorization) request.headers.authorization = authorization;
  return {
    request,
    executionContext: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe("PlatformAuthGuard", () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = accessSecret;
    process.env.JWT_REFRESH_SECRET = "platform-refresh-secret-for-tests";
    process.env.QR_CREDENTIAL_SECRET = "platform-qr-secret-for-unit-tests";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.EMAIL_PROVIDER = "test";
    process.env.PAYMENT_PROVIDER = "test";
    process.env.NODE_ENV = "test";
    __resetEnvCacheForTests();
    mockPlatformUserFindUnique.mockResolvedValue({ active: true, refreshTokenVersion: 0 });
  });

  it("accepts a dedicated platform token", async () => {
    const { executionContext, request } = context(`Bearer ${token("PLATFORM")}`);
    await expect(new PlatformAuthGuard().canActivate(executionContext)).resolves.toBe(true);
    expect(request.actor).toMatchObject({ actorType: "PLATFORM" });
  });

  it("rejects an ordinary cinema employee token", async () => {
    const { executionContext } = context(`Bearer ${token("EMPLOYEE")}`);
    await expect(new PlatformAuthGuard().canActivate(executionContext)).rejects.toThrow("Attend platform access is required.");
  });

  it("rejects an invalidated platform token", async () => {
    mockPlatformUserFindUnique.mockResolvedValue({ active: true, refreshTokenVersion: 1 });
    const { executionContext } = context(`Bearer ${token("PLATFORM")}`);
    await expect(new PlatformAuthGuard().canActivate(executionContext)).rejects.toThrow("session is no longer valid");
  });
});
