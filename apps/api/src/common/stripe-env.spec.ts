import { __resetEnvCacheForTests, loadEnv, loadStripeEnv } from "@cinema/config/env";

const liveStripe = {
  NODE_ENV: "production",
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
  STRIPE_PUBLISHABLE_KEY: "pk_live_example",
} as const;

describe("Stripe environment safety", () => {
  afterEach(() => __resetEnvCacheForTests());

  it("accepts matching test keys in non-production environments", () => {
    expect(loadStripeEnv({ ...liveStripe, NODE_ENV: "development", STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_PUBLISHABLE_KEY: "pk_test_example" })).toMatchObject({ STRIPE_MODE: "test" });
  });

  it("accepts matching live keys only in production", () => {
    expect(loadStripeEnv(liveStripe)).toMatchObject({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_example", STRIPE_PUBLISHABLE_KEY: "pk_live_example" });
    expect(() => loadStripeEnv({ ...liveStripe, NODE_ENV: "development" })).toThrow("Stripe live mode is only allowed when NODE_ENV=production");
  });

  it("rejects mixed or mode-mismatched key pairs", () => {
    expect(() => loadStripeEnv({ ...liveStripe, STRIPE_PUBLISHABLE_KEY: "pk_test_example" })).toThrow("pk_live_");
    expect(() => loadStripeEnv({ ...liveStripe, STRIPE_MODE: "test" })).toThrow("sk_test_");
  });

  it("validates the existing customer-web publishable-key alias", () => {
    expect(loadStripeEnv({ NODE_ENV: liveStripe.NODE_ENV, STRIPE_MODE: liveStripe.STRIPE_MODE, STRIPE_SECRET_KEY: liveStripe.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: liveStripe.STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_example" })).toMatchObject({ STRIPE_PUBLISHABLE_KEY: "pk_live_example" });
  });

  it("allows the full API configuration to boot in explicit live mode", () => {
    const nonCredentialTestValue = "x".repeat(40);
    const env = loadEnv({
      ...liveStripe,
      DATABASE_URL: "postgresql://localhost/test",
      REDIS_URL: "redis://localhost:6379",
      JWT_ACCESS_SECRET: nonCredentialTestValue,
      JWT_REFRESH_SECRET: nonCredentialTestValue,
      QR_CREDENTIAL_SECRET: nonCredentialTestValue,
      EMAIL_PROVIDER: "postmark",
      POSTMARK_SERVER_TOKEN: "postmark-token",
      PAYMENT_PROVIDER: "stripe",
      OBSERVABILITY_TOKEN: nonCredentialTestValue,
    });
    expect(env.STRIPE_MODE).toBe("live");
  });
});
