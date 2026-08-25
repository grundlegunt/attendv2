import { z } from "zod/v3";

const stripeModeSchema = z.enum(["test", "live"]);

function addStripeIssues(env: { STRIPE_MODE: "test" | "live"; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PUBLISHABLE_KEY?: string }, context: z.RefinementCtx) {
  const secretPrefix = env.STRIPE_MODE === "live" ? "sk_live_" : "sk_test_";
  const publishablePrefix = env.STRIPE_MODE === "live" ? "pk_live_" : "pk_test_";
  if (!env.STRIPE_SECRET_KEY?.startsWith(secretPrefix)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_SECRET_KEY"], message: `STRIPE_SECRET_KEY must be a Stripe ${env.STRIPE_MODE}-mode secret key (${secretPrefix}…).` });
  }
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_WEBHOOK_SECRET"], message: "A Stripe webhook signing secret (whsec_…) is required." });
  }
  if (!env.STRIPE_PUBLISHABLE_KEY?.startsWith(publishablePrefix)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_PUBLISHABLE_KEY"], message: `STRIPE_PUBLISHABLE_KEY must be a Stripe ${env.STRIPE_MODE}-mode publishable key (${publishablePrefix}…).` });
  }
}

const stripeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STRIPE_MODE: stripeModeSchema.default("test"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
}).superRefine((env, context) => {
  if (env.STRIPE_MODE === "live" && env.NODE_ENV !== "production") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_MODE"], message: "Stripe live mode is only allowed when NODE_ENV=production." });
  }
  addStripeIssues(env, context);
});

export function loadStripeEnv(source: NodeJS.ProcessEnv = process.env) {
  // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY remains a compatibility alias for
  // existing customer-web deployments; all validation and runtime access
  // still flow through this one loader.
  const normalized = { ...source, STRIPE_PUBLISHABLE_KEY: source.STRIPE_PUBLISHABLE_KEY ?? source.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY };
  const result = stripeEnvSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`Invalid Stripe configuration.\n${result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n")}`);
  }
  return result.data as typeof result.data & { STRIPE_SECRET_KEY: string; STRIPE_WEBHOOK_SECRET: string; STRIPE_PUBLISHABLE_KEY: string };
}

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
  CUSTOMER_WEB_URL: z.string().url().default("http://localhost:3000"),

  SMS_PROVIDER: z.enum(["disabled", "twilio", "test"]).default("disabled"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().regex(/^\+[1-9]\d{7,14}$/, "TWILIO_FROM must be an E.164 phone number").optional(),

  PAYMENT_PROVIDER: z.enum(["stripe", "test"]).default("stripe"),
  // Live mode is an explicit production-only opt-in. Test mode remains valid
  // in production previews and staging environments.
  STRIPE_MODE: stripeModeSchema.default("test"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Comma-separated hostnames where Stripe Elements is rendered. Stripe
  // Connect direct charges require each hostname to be registered against
  // every connected account (Dashboard registration only covers the
  // platform account).
  PAYMENT_METHOD_DOMAINS: z.string().default(""),

  // How often the durable refund-reconciliation sweep
  // (TicketingService.reconcilePendingRefunds) runs, in milliseconds. See
  // RefundReconciliationService in apps/api. Set to 0 to disable the
  // background sweep entirely (e.g. in tests that manage reconciliation
  // explicitly).
  REFUND_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  // How often failed online gift-card email deliveries are retried. Delivery
  // uses a database lease, so concurrent API instances can sweep safely.
  GIFT_CARD_DELIVERY_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  // How often failed online ticket receipt deliveries are retried. Receipt
  // delivery uses a database lease, so concurrent API instances can sweep
  // safely.
  TICKET_RECEIPT_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  // How often unsent customer password-reset emails are retried. Reset tokens
  // are generated only when a leased delivery attempt begins and are never
  // persisted.
  CUSTOMER_AUTH_EMAIL_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  // How often the API checks for seat-linked restaurant tabs whose automatic
  // settlement time has arrived. Set to 0 in tests that invoke the sweep
  // explicitly.
  RESTAURANT_SETTLEMENT_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),

  AUTH_RATE_LIMIT_ATTEMPTS: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  CHECKOUT_RATE_LIMIT_ATTEMPTS: z.coerce.number().int().positive().default(30),
  CHECKOUT_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // Protects the machine-facing operational metrics endpoint. This is a
  // distinct secret from application/session credentials.
  OBSERVABILITY_TOKEN: z.string().min(32).optional(),
  // Optional vendor-neutral destination for redacted unexpected-error alerts.
  // The API never forwards exception messages, request bodies, query strings,
  // authentication headers, or payment/customer data.
  ERROR_ALERT_WEBHOOK_URL: z.string().url().optional(),

  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003,http://127.0.0.1:3004"),
}).superRefine((env, context) => {
  if (env.STRIPE_MODE === "live" && env.NODE_ENV !== "production") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_MODE"], message: "Stripe live mode is only allowed when NODE_ENV=production." });
  }
  if (env.NODE_ENV === "production" && !env.OBSERVABILITY_TOKEN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["OBSERVABILITY_TOKEN"], message: "OBSERVABILITY_TOKEN is required in production." });
  }
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
  if (env.SMS_PROVIDER === "test" && env.NODE_ENV !== "test") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["SMS_PROVIDER"], message: "The test SMS provider is only allowed when NODE_ENV=test." });
  }
  if (env.SMS_PROVIDER === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"] as const) {
      if (!env[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when SMS_PROVIDER=twilio.` });
    }
  }
  if (env.PAYMENT_PROVIDER === "stripe") {
    addStripeIssues(env, context);
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

  const normalized = {
    ...source,
    CUSTOMER_WEB_URL:
      source.CUSTOMER_WEB_URL ?? source.NEXT_PUBLIC_CUSTOMER_WEB_URL,
    ERROR_ALERT_WEBHOOK_URL: source.ERROR_ALERT_WEBHOOK_URL || undefined,
  };
  const result = envSchema.safeParse(normalized);
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
