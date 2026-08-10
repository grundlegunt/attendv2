import type { ExecutionContext } from "@nestjs/common";

describe("RequestRateLimitGuard", () => {
  it("blocks repeated authentication attempts for both an identity and source IP", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.JWT_ACCESS_SECRET = "test-access-secret-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";
    process.env.QR_CREDENTIAL_SECRET = "test-qr-secret-at-least-32-characters";
    process.env.PAYMENT_PROVIDER = "test";
    process.env.EMAIL_PROVIDER = "test";
    process.env.AUTH_RATE_LIMIT_ATTEMPTS = "3";
    const { __resetEnvCacheForTests } = await import("@cinema/config/env");
    __resetEnvCacheForTests();
    const { RequestRateLimitGuard } = await import("./request-rate-limit.guard");
    const reflector = { get: () => ({ scope: "auth", identity: "email" }) };
    const guard = new RequestRateLimitGuard(reflector as never);
    const request = { baseUrl: "/api/v1/auth", route: { path: "/staff/login" }, path: "/staff/login", ip: "127.0.0.1", body: { email: "OWNER@EXAMPLE.COM" }, headers: {} };
    const context = { getHandler: () => function login() {}, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await guard.onModuleDestroy();
  });

  it("applies anonymous checkout limits by source IP even when client identifiers rotate", async () => {
    process.env.CHECKOUT_RATE_LIMIT_ATTEMPTS = "2";
    const { __resetEnvCacheForTests } = await import("@cinema/config/env");
    __resetEnvCacheForTests();
    const { RequestRateLimitGuard } = await import("./request-rate-limit.guard");
    const reflector = { get: () => ({ scope: "checkout" }) };
    const guard = new RequestRateLimitGuard(reflector as never);
    const request = { baseUrl: "/api/v1/ticketing", route: { path: "/checkouts" }, path: "/checkouts", ip: "127.0.0.2", body: {}, headers: {} };
    const context = { getHandler: () => function checkout() {}, switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    request.body = { holderKey: "rotating-holder-1", requestId: "rotating-request-1" };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    request.body = { holderKey: "rotating-holder-2", requestId: "rotating-request-2" };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    request.body = { holderKey: "rotating-holder-3", requestId: "rotating-request-3" };
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await guard.onModuleDestroy();
  });
});
