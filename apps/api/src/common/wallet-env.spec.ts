import { __resetEnvCacheForTests, loadEnv } from "@cinema/config/env";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "x".repeat(40),
  JWT_REFRESH_SECRET: "y".repeat(40),
  QR_CREDENTIAL_SECRET: "z".repeat(40),
  EMAIL_PROVIDER: "test",
  PAYMENT_PROVIDER: "test",
} as const;

describe("wallet environment safety", () => {
  afterEach(() => __resetEnvCacheForTests());

  it("keeps both wallet platforms disabled by default", () => {
    expect(loadEnv(base)).toMatchObject({
      APPLE_WALLET_PROVIDER: "disabled",
      GOOGLE_WALLET_PROVIDER: "disabled",
    });
  });

  it("rejects incomplete Apple issuer configuration", () => {
    expect(() => loadEnv({ ...base, APPLE_WALLET_PROVIDER: "passkit" })).toThrow("APPLE_WALLET_TEAM_ID is required");
  });

  it("rejects incomplete Google issuer configuration", () => {
    expect(() => loadEnv({ ...base, GOOGLE_WALLET_PROVIDER: "google" })).toThrow("GOOGLE_WALLET_ISSUER_ID is required");
  });

  it("accepts test providers only in the test environment", () => {
    expect(loadEnv({ ...base, APPLE_WALLET_PROVIDER: "test", GOOGLE_WALLET_PROVIDER: "test" })).toMatchObject({ APPLE_WALLET_PROVIDER: "test", GOOGLE_WALLET_PROVIDER: "test" });
    __resetEnvCacheForTests();
    expect(() => loadEnv({ ...base, NODE_ENV: "development", APPLE_WALLET_PROVIDER: "test" })).toThrow("Test wallet providers are only allowed");
  });
});
