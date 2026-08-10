import { ExecutionContext } from "@nestjs/common";
import { signTokenPair } from "@cinema/auth";
import { __resetEnvCacheForTests } from "@cinema/config/env";
import { PlatformAuthGuard } from "./platform-auth.guard";

const accessSecret = "platform-access-secret-for-unit-tests";

function token(actorType: "PLATFORM" | "EMPLOYEE") {
  return signTokenPair(
    { sub: `${actorType.toLowerCase()}-1`, actorType, permissions: [] },
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
  });

  it("accepts a dedicated platform token", () => {
    const { executionContext, request } = context(`Bearer ${token("PLATFORM")}`);
    expect(new PlatformAuthGuard().canActivate(executionContext)).toBe(true);
    expect(request.actor).toMatchObject({ actorType: "PLATFORM" });
  });

  it("rejects an ordinary cinema employee token", () => {
    const { executionContext } = context(`Bearer ${token("EMPLOYEE")}`);
    expect(() => new PlatformAuthGuard().canActivate(executionContext)).toThrow("Attend platform access is required.");
  });
});
