import { z } from "zod";

/**
 * Environment variable schema for the API service.
 *
 * Per SECURITY.md §6 and AGENTS.md §6: the application must fail fast at boot
 * if a required secret/config value is missing, rather than run in a
 * degraded or insecure state. This is the single source of truth for what
 * "required configuration" means — do not read `process.env` directly
 * anywhere else in the codebase.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // JWT signing secrets. Must never be reused between access and refresh
  // tokens, and must never be committed — see AGENTS.md §4 / SECURITY.md §6.
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 minutes
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(1209600), // 14 days
  QR_CREDENTIAL_SECRET: z.string().min(32, "QR_CREDENTIAL_SECRET must be at least 32 characters"),

  EMAIL_PROVIDER: z.enum(["postmark", "test"]).default("postmark"),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().email().default("receipts@example.com"),

  PAYMENT_PROVIDER: z.enum(["stripe", "test"]).default("stripe"),
  // Stripe — test-mode keys only during Milestone 3 development.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // How often the durable refund-reconciliation sweep
  // (TicketingService.reconcilePendingRefunds) runs, in milliseconds. See
  // RefundReconciliationService in apps/api. Set to 0 to disable the
  // background sweep entirely (e.g. in tests that manage reconciliation
  // explicitly).
  REFUND_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003"),
}).superRefine((env, context) => {
  if (env.PAYMENT_PROVIDER === "test" && env.NODE_ENV !== "test") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYMENT_PROVIDER"],
      message: "The test payment provider is only allowed when NODE_ENV=test.",
    });
  }
  if (env.EMAIL_PROVIDER === "test" && env.NODE_ENV !== "test") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["EMAIL_PROVIDER"],
      message: "The test email provider is only allowed when NODE_ENV=test.",
    });
  }
  if (env.EMAIL_PROVIDER === "postmark" && !env.POSTMARK_SERVER_TOKEN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["POSTMARK_SERVER_TOKEN"],
      message: "A Postmark server token is required when EMAIL_PROVIDER=postmark.",
    });
  }
  if (env.PAYMENT_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_SECRET_KEY"],
        message: "A Stripe test-mode secret key is required for Milestone 3.",
      });
    }
    if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "A Stripe webhook signing secret is required for Milestone 3.",
      });
    }
    if (!env.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_PUBLISHABLE_KEY"],
        message: "A Stripe test-mode publishable key is required for Milestone 3.",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Validates and returns process.env against the schema above. Throws with a
 * clear, actionable error (not a generic crash) if anything required is
 * missing or malformed. Call this once at boot; the result is cached.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment configuration. Refusing to start.\n${issues}\n\n` +
        `See .env.example for the full list of required variables.`,
    );
  }

  cachedEnv = result.data;
  return cachedEnv;
}

/** Test-only helper to reset the cache between test files. */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
