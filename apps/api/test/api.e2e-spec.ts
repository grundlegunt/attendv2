/**
 * Milestone 0 integration test. Boots a real, ephemeral Postgres instance
 * (test-db.ts), a real NestJS application (not a mocked HTTP layer), and
 * exercises it over real HTTP via supertest. Covers the completion
 * criteria from IMPLEMENTATION_PLAN.md Milestone 0:
 *   - health check reflects real DB connectivity
 *   - a protected route is 401 without a token, 200 with a valid one
 *   - staff login/refresh/logout work against real seeded accounts
 *   - the RBAC guard framework actually denies a role lacking a permission
 *   - customer registration/login work and reject duplicate emails
 *
 * IMPORTANT: nothing that touches @cinema/database (whose PrismaClient
 * singleton binds to DATABASE_URL at import time) may be statically
 * imported at the top of this file — the test database's connection
 * string isn't known until `startTestDatabase()` resolves in beforeAll.
 * Those imports are deliberately dynamic below.
 */
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { startTestDatabase, TestDatabase } from "./test-db";

let testDb: TestDatabase;
let app: INestApplication;
let ownerAccessToken: string;
let ownerRefreshToken: string;
let platformAccessToken: string;
let platformRefreshToken: string;
let milestone4Credential: string;
let milestone4TicketId: string;
let milestone8TabId: string;

const SEED_SUFFIX = "m0test.local";
// Matches SEED_PASSWORD in packages/database/prisma/seed.ts.
const SEED_PASSWORD = "DevPassword123!";
const CUSTOMER_WEB_ORIGIN = "http://localhost:3000";
const OWNER_MFA_SECRET = "AAAAAAAAAAAAAAAA";

async function loginOwner() {
  return request(app.getHttpServer())
    .post("/api/v1/auth/staff/login")
    .send({ email: `owner@${SEED_SUFFIX}`, password: SEED_PASSWORD });
}

function setCookieHeaders(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}

function cookiePair(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Response did not set ${name}.`);
  return cookie.split(";", 1)[0]!;
}

beforeAll(async () => {
  try {
  testDb = await startTestDatabase();

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDb.databaseUrl;
  process.env.REDIS_URL = "redis://127.0.0.1:6379"; // unused in Milestone 0, required by env schema
  process.env.JWT_ACCESS_SECRET = "test-access-secret-32-characters-min";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-characters-min";
  process.env.QR_CREDENTIAL_SECRET = "test-qr-credential-secret-32-characters-min";
  process.env.PAYMENT_PROVIDER = "test";
  process.env.EMAIL_PROVIDER = "test";
  process.env.RESTAURANT_SETTLEMENT_INTERVAL_MS = "0";
  process.env.OBSERVABILITY_TOKEN = "test-observability-token-at-least-32-characters";
  process.env.AUTH_RATE_LIMIT_ATTEMPTS = "100";

  const { __resetEnvCacheForTests } = await import("../../../packages/config/src/env");
  __resetEnvCacheForTests();

  const { prisma } = await import("@cinema/database");
  const { seedDatabase } = await import("../../../packages/database/prisma/seed");
  await seedDatabase(prisma, { silent: true, emailSuffix: SEED_SUFFIX, ownerMfaSecret: OWNER_MFA_SECRET });

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module");
  const { GlobalExceptionFilter } = await import("../src/common/http-exception.filter");

  const nestApp = await NestFactory.create(AppModule, {
    logger: false,
    rawBody: true,
  });
  nestApp.useGlobalFilters(new GlobalExceptionFilter());
  nestApp.setGlobalPrefix("api/v1");
  await nestApp.init();
  app = nestApp;
  } catch (error) {
    // Preserve setup diagnostics in CI; Jest can otherwise collapse a shared
    // beforeAll failure into blank output for every test in the file.
    // eslint-disable-next-line no-console
    console.error("Integration test setup failed", error);
    throw error;
  }
}, 60000);

afterAll(async () => {
  const { prisma } = await import("@cinema/database");
  await app?.close();
  await prisma.$disconnect();
  await testDb?.stop();
});

describe("GET /api/v1/health", () => {
  it("reports ok status and a connected database", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
  });

  it("separates liveness, dependency readiness, and protected operational signals", async () => {
    const live = await request(app.getHttpServer()).get("/api/v1/health/live").expect(200);
    expect(live.body).toEqual(expect.objectContaining({ status: "ok" }));
    const ready = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    expect(ready.body).toEqual(expect.objectContaining({ status: "ok", database: "connected", redis: "not-required-in-tests" }));
    await request(app.getHttpServer()).get("/api/v1/health/operations").expect(401);
    const operations = await request(app.getHttpServer()).get("/api/v1/health/operations").set("Authorization", `Bearer ${process.env.OBSERVABILITY_TOKEN}`).expect(200);
    expect(operations.body).toEqual(expect.objectContaining({ failedPayments15m: expect.any(Number), stalePayments: expect.any(Number), staleRefunds: expect.any(Number), managerReviewTabs: expect.any(Number), expiredHoldBacklog: expect.any(Number), attentionEvents15m: expect.any(Number) }));
  });
});

describe("Staff authentication", () => {
  it("rejects login with an incorrect password", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `owner@${SEED_SUFFIX}`, password: "totally-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects login for an unknown email without revealing whether the account exists", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: "nobody@nowhere.test", password: "whatever123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs the seeded Owner in and returns tokens plus a flattened permission set", async () => {
    const res = await loginOwner();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.employee.roles).toContain("OWNER");
    expect(res.body.employee.permissions).toContain("audit.log.view");
    expect(res.body.employee).toMatchObject({ mfaEnabled: false, mfaSetupRequired: false });
    expect(res.body.mfaRequired).toBeUndefined();

    ownerAccessToken = res.body.accessToken;
    ownerRefreshToken = res.body.refreshToken;
  });

  it("rejects an unauthenticated request to a protected route (401)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/staff/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a request with a garbage bearer token (401)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/staff/me")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("allows an authenticated request to a protected route (200)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/staff/me")
      .set("Authorization", `Bearer ${ownerAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(`owner@${SEED_SUFFIX}`);
  });

  it("forces a manager-reset employee to replace the temporary password and invalidates prior sessions", async () => {
    const people = await request(app.getHttpServer()).get("/api/v1/management/people").set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    const serverRole = people.body.roles.find((role: { key: string }) => role.key === "SERVER");
    expect(serverRole).toBeTruthy();
    const resetEmail = `reset-${crypto.randomUUID()}@${SEED_SUFFIX}`;
    const server = await request(app.getHttpServer())
      .post("/api/v1/management/employees")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: "Reset Test Server", email: resetEmail, password: SEED_PASSWORD, pin: "1234", roleIds: [serverRole.id] })
      .expect(201);
    const updatedEmail = `updated-${crypto.randomUUID()}@${SEED_SUFFIX}`;
    await request(app.getHttpServer())
      .patch(`/api/v1/management/employees/${server.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: "Updated Test Server", email: updatedEmail.toUpperCase() })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe("Updated Test Server");
        expect(body.email).toBe(updatedEmail);
      });
    await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: resetEmail, password: SEED_PASSWORD }).expect(401);
    const previous = await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: updatedEmail, password: SEED_PASSWORD }).expect(200);

    await request(app.getHttpServer()).patch(`/api/v1/management/employees/${server.body.id}/credentials`).set("Authorization", `Bearer ${ownerAccessToken}`).send({ password: "TemporaryPassword123!", pin: "5678" }).expect(200);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/refresh").send({ refreshToken: previous.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: resetEmail, password: SEED_PASSWORD }).expect(401);

    const temporary = await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: updatedEmail, password: "TemporaryPassword123!" }).expect(200);
    expect(temporary.body.employee.mustChangePassword).toBe(true);
    expect(temporary.body.employee.permissions).toEqual([]);
    await request(app.getHttpServer()).get("/api/v1/audit-events").set("Authorization", `Bearer ${temporary.body.accessToken}`).expect(403);

    const changed = await request(app.getHttpServer()).post("/api/v1/auth/staff/change-password").set("Authorization", `Bearer ${temporary.body.accessToken}`).send({ currentPassword: "TemporaryPassword123!", newPassword: SEED_PASSWORD }).expect(200);
    expect(changed.body.employee.mustChangePassword).toBe(false);
    expect(changed.body.employee.permissions.length).toBeGreaterThan(0);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/refresh").send({ refreshToken: temporary.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: updatedEmail, password: SEED_PASSWORD }).expect(200);

    await request(app.getHttpServer()).patch(`/api/v1/management/employees/${server.body.id}/credentials`).set("Authorization", `Bearer ${ownerAccessToken}`).send({ pin: "1234" }).expect(200);
    const { prisma } = await import("@cinema/database");
    await prisma.staffAuthAccount.update({ where: { employeeId: server.body.id }, data: { mfaEnabled: true, mfaSecretEncrypted: "test-encrypted-secret" } });
    await request(app.getHttpServer()).patch(`/api/v1/management/employees/${server.body.id}/credentials`).set("Authorization", `Bearer ${ownerAccessToken}`).send({ resetMfa: true }).expect(200).expect(({ body }) => expect(body.mfaReset).toBe(true));
    const resetAccount = await prisma.staffAuthAccount.findUniqueOrThrow({ where: { employeeId: server.body.id } });
    expect(resetAccount.mfaEnabled).toBe(false);
    expect(resetAccount.mfaSecretEncrypted).toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "employee.credentials_reset", entityId: server.body.id }, orderBy: { occurredAt: "desc" } });
    expect(audit?.afterState).toMatchObject({ mfaReset: true });
    expect(JSON.stringify(audit?.afterState)).not.toContain("TemporaryPassword123!");
    expect(JSON.stringify(audit?.afterState)).not.toContain("5678");
  });

  it("issues a new token pair from a valid refresh token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/refresh")
      .send({ refreshToken: ownerRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it("invalidates outstanding refresh tokens on logout", async () => {
    const logoutRes = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/logout")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/refresh")
      .send({ refreshToken: ownerRefreshToken });
    expect(refreshAfterLogout.status).toBe(401);

    // Access token itself remains valid until its own short TTL expires —
    // logout invalidates the refresh token, not already-issued access
    // tokens. Re-establish a fresh session for the tests that follow.
    const loginAgain = await loginOwner();
    ownerAccessToken = loginAgain.body.accessToken;
  });
});

describe("Attend platform authentication boundary", () => {
  it("logs a separately seeded Attend operator in", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/platform/auth/login")
      .send({ email: "platform@attend.test", password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toEqual(expect.objectContaining({
      email: "platform@attend.test",
      name: "Attend Operator",
    }));
    platformAccessToken = res.body.accessToken;
    platformRefreshToken = res.body.refreshToken;
  });

  it("refreshes an active Attend Master session and rejects other actor tokens", async () => {
    const refreshed = await request(app.getHttpServer())
      .post("/api/v1/platform/auth/refresh")
      .send({ refreshToken: platformRefreshToken })
      .expect(200);
    expect(refreshed.body).toEqual(expect.objectContaining({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: expect.objectContaining({ email: "platform@attend.test", role: "OWNER" }),
    }));
    platformAccessToken = refreshed.body.accessToken;
    platformRefreshToken = refreshed.body.refreshToken;

    await request(app.getHttpServer())
      .post("/api/v1/platform/auth/refresh")
      .send({ refreshToken: ownerRefreshToken })
      .expect(401);
  });

  it("rejects a cinema employee token from the Attend Master API", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${ownerAccessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns a read-only cinema overview to an Attend operator", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.generatedAt).toEqual(expect.any(String));
    expect(res.body.organizations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Meridian Cinema Co.",
        locations: expect.arrayContaining([
          expect.objectContaining({
            name: "Meridian Cinema",
            configuration: expect.objectContaining({
              auditoriums: expect.any(Number),
              employees: expect.any(Number),
              menuItems: expect.any(Number),
              upcomingShowtimes: expect.any(Number),
            }),
          }),
        ]),
      }),
    ]));
  });

  it("returns a separated cross-client revenue rollup only to Attend operators", async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    await request(app.getHttpServer()).get(`/api/v1/platform/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(403);
    const res = await request(app.getHttpServer()).get(`/api/v1/platform/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    expect(res.body.totals).toEqual(expect.objectContaining({ ticketRevenueCents: expect.any(Number), ticketFeesCents: expect.any(Number), ticketTaxCents: expect.any(Number), ticketCollectedCents: expect.any(Number), fnbRevenueCents: expect.any(Number), refundedCents: expect.any(Number) }));
    expect(res.body.totals.ticketRevenueCents + res.body.totals.ticketFeesCents + res.body.totals.ticketTaxCents).toBe(res.body.totals.ticketCollectedCents);
    expect(res.body.clients).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Meridian Cinema Co.", ticketRevenueCents: expect.any(Number) })]));
    await request(app.getHttpServer()).get("/api/v1/platform/revenue?from=not-a-date").set("Authorization", `Bearer ${platformAccessToken}`).expect(400);
  });

  it("lets only an Attend operator search the platform audit trail", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/platform/audit-events")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .get("/api/v1/platform/audit-events?action=platform.login&limit=10")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.events).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "platform.login",
      actor: expect.objectContaining({ email: "platform@attend.test" }),
    })]));
    expect(res.body.events.every((event: { action: string }) => event.action.includes("platform.login"))).toBe(true);

    await request(app.getHttpServer())
      .get("/api/v1/platform/audit-events?from=not-a-date")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(400);
  });

  it("lets Attend operators add and revoke company team access safely", async () => {
    await request(app.getHttpServer()).get("/api/v1/platform/team").set("Authorization", `Bearer ${ownerAccessToken}`).expect(403);
    const initial = await request(app.getHttpServer()).get("/api/v1/platform/team").set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    expect(initial.body.users).toEqual(expect.arrayContaining([expect.objectContaining({ email: "platform@attend.test", role: "OWNER", active: true })]));
    const current = initial.body.users.find((user: { email: string }) => user.email === "platform@attend.test");

    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${current.id}`).set("Authorization", `Bearer ${platformAccessToken}`).send({ active: false }).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${current.id}`).set("Authorization", `Bearer ${platformAccessToken}`).send({ role: "OPERATOR" }).expect(409);

    const email = `platform-support@${SEED_SUFFIX}`;
    const created = await request(app.getHttpServer()).post("/api/v1/platform/team").set("Authorization", `Bearer ${platformAccessToken}`).send({ name: "Platform Support", email, password: "PlatformSupportPassword123!" }).expect(201);
    expect(created.body).toMatchObject({ email, role: "OPERATOR", active: true });
    await request(app.getHttpServer()).post("/api/v1/platform/team").set("Authorization", `Bearer ${platformAccessToken}`).send({ name: "Duplicate", email, password: "PlatformSupportPassword123!" }).expect(409);

    const resetPassword = "ResetPlatformPassword456!";
    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${created.body.id}/credentials`).set("Authorization", `Bearer ${ownerAccessToken}`).send({ password: resetPassword }).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${created.body.id}/credentials`).set("Authorization", `Bearer ${platformAccessToken}`).send({ password: "too-short" }).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${created.body.id}/credentials`).set("Authorization", `Bearer ${platformAccessToken}`).send({ password: resetPassword }).expect(200).expect(({ body }) => expect(body).toEqual({ id: created.body.id, passwordReset: true }));
    await request(app.getHttpServer()).post("/api/v1/platform/auth/login").send({ email, password: "PlatformSupportPassword123!" }).expect(401);

    const supportLogin = await request(app.getHttpServer()).post("/api/v1/platform/auth/login").send({ email, password: resetPassword }).expect(200);
    expect(supportLogin.body.user.role).toBe("OPERATOR");
    await request(app.getHttpServer()).get("/api/v1/platform/team").set("Authorization", `Bearer ${supportLogin.body.accessToken}`).expect(403);
    const operatorOverview = await request(app.getHttpServer()).get("/api/v1/platform/overview").set("Authorization", `Bearer ${supportLogin.body.accessToken}`).expect(200);
    const operatorOrganization = operatorOverview.body.organizations[0];
    await request(app.getHttpServer()).patch(`/api/v1/platform/organizations/${operatorOrganization.id}`).set("Authorization", `Bearer ${supportLogin.body.accessToken}`).send({ name: operatorOrganization.name }).expect(200);

    const viewerEmail = `platform-viewer@${SEED_SUFFIX}`;
    await request(app.getHttpServer()).post("/api/v1/platform/team").set("Authorization", `Bearer ${platformAccessToken}`).send({ name: "Platform Viewer", email: viewerEmail, password: "PlatformViewerPassword123!", role: "VIEWER" }).expect(201);
    const viewerLogin = await request(app.getHttpServer()).post("/api/v1/platform/auth/login").send({ email: viewerEmail, password: "PlatformViewerPassword123!" }).expect(200);
    expect(viewerLogin.body.user.role).toBe("VIEWER");
    await request(app.getHttpServer()).get("/api/v1/platform/overview").set("Authorization", `Bearer ${viewerLogin.body.accessToken}`).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/platform/organizations/${operatorOrganization.id}`).set("Authorization", `Bearer ${viewerLogin.body.accessToken}`).send({ name: operatorOrganization.name }).expect(403);
    await request(app.getHttpServer()).get("/api/v1/platform/team").set("Authorization", `Bearer ${viewerLogin.body.accessToken}`).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/platform/team/${created.body.id}`).set("Authorization", `Bearer ${platformAccessToken}`).send({ active: false }).expect(200);
    expect(supportLogin.body.accessToken).toEqual(expect.any(String));
    await request(app.getHttpServer()).post("/api/v1/platform/auth/login").send({ email, password: "PlatformSupportPassword123!" }).expect(401);

    const audit = await request(app.getHttpServer()).get("/api/v1/platform/audit-events?action=platform.user_").set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    expect(audit.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ action: "platform.user_created", entityId: created.body.id }), expect.objectContaining({ action: "platform.user_credentials_reset", entityId: created.body.id, afterState: { passwordReset: true } }), expect.objectContaining({ action: "platform.user_updated", entityId: created.body.id })]));
    expect(JSON.stringify(audit.body.events)).not.toContain(resetPassword);
  });

  it("returns a detailed organization view only to an Attend operator", async () => {
    const overview = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);
    const meridian = overview.body.organizations.find(
      (organization: { name: string }) => organization.name === "Meridian Cinema Co.",
    );
    expect(meridian).toBeDefined();
    const organizationId = meridian.id as string;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      id: organizationId,
      payments: expect.objectContaining({ onboardingStatus: expect.any(String) }),
      locations: expect.arrayContaining([expect.objectContaining({
        branding: expect.any(Object),
        adminBranding: expect.any(Object),
        operations: expect.objectContaining({ cleaningBufferMinutes: expect.any(Number) }),
        configuration: expect.objectContaining({ activeMovies: expect.any(Number), activeFilmSeries: expect.any(Number) }),
      })]),
    }));
    expect(res.body.locations[0].branding).toHaveProperty("accentColor");
    expect(res.body.locations[0].adminBranding).toHaveProperty("accentColor");

    await request(app.getHttpServer())
      .get(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/api/v1/platform/organizations/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(404);
  });

  it("lets an Attend operator create a cinema organization with its first location", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/platform/organizations")
      .send({
        name: "Unauthorized Cinema Co.",
        timezone: "America/Chicago",
        location: { name: "Unauthorized Cinema", timezone: "America/Chicago" },
      })
      .expect(401);

    const created = await request(app.getHttpServer())
      .post("/api/v1/platform/organizations")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({
        name: "Bluebird Cinema Co.",
        legalName: "Bluebird Cinema Co. LLC",
        timezone: "America/New_York",
        location: {
          name: "Bluebird Cinema",
          address: "100 Main Street, Richmond, VA",
          timezone: "America/New_York",
        },
      })
      .expect(201);

    expect(created.body).toEqual(expect.objectContaining({
      name: "Bluebird Cinema Co.",
      legalName: "Bluebird Cinema Co. LLC",
      locations: [expect.objectContaining({
        name: "Bluebird Cinema",
        address: "100 Main Street, Richmond, VA",
        timezone: "America/New_York",
      })],
    }));
  });

  it("lets an Attend operator provision a non-MFA cinema manager for an isolated location", async () => {
    const overview = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);
    const bluebird = overview.body.organizations.find((organization: { name: string }) => organization.name === "Bluebird Cinema Co.");
    expect(bluebird).toBeDefined();
    const email = `bluebird-manager@${SEED_SUFFIX}`;
    const password = "CinemaSandboxPassword123!";

    await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${bluebird.id}/locations/${bluebird.locations[0].id}/cinema-manager`)
      .send({ name: "Bluebird Manager", email, password })
      .expect(401);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${bluebird.id}/locations/${bluebird.locations[0].id}/cinema-manager`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ name: "Bluebird Manager", email, password })
      .expect(201);
    expect(created.body).toMatchObject({ email, role: "CINEMA_MANAGER", mfaRequired: false });

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email, password })
      .expect(200);
    expect(login.body).toEqual(expect.objectContaining({
      accessToken: expect.any(String),
      employee: expect.objectContaining({ locationId: bluebird.locations[0].id, roles: ["CINEMA_MANAGER"] }),
    }));
    expect(login.body.mfaRequired).not.toBe(true);
  });

  it("lets only an Attend operator update organization and location configuration", async () => {
    const overview = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);
    const meridian = overview.body.organizations.find(
      (organization: { name: string }) => organization.name === "Meridian Cinema Co.",
    );
    expect(meridian).toBeDefined();
    const organizationId = meridian.id as string;
    const locationId = meridian.locations[0].id as string;

    const organization = await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ legalName: "Meridian Cinema Co. LLC" })
      .expect(200);
    expect(organization.body).toEqual(expect.objectContaining({
      legalName: "Meridian Cinema Co. LLC",
    }));

    const location = await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}/locations/${locationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ preShowBufferMinutes: 35, timeClockEnabled: false })
      .expect(200);
    expect(location.body.locations[0]).toEqual(expect.objectContaining({
      operations: expect.objectContaining({ preShowBufferMinutes: 35, timeClockEnabled: false }),
    }));

    const draft = await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}/locations/${locationId}/branding/draft`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ accentColor: "#fe2c54", adminAccentColor: "#4c7dff", adminBackgroundColor: "#10131a", adminUi: location.body.locations[0].adminBranding.ui })
      .expect(200);
    expect(draft.body.locations[0].brandingDraft.values).toEqual(expect.objectContaining({ accentColor: "#fe2c54", adminAccentColor: "#4c7dff", adminBackgroundColor: "#10131a" }));

    const published = await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/locations/${locationId}/branding/publish`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(201);
    expect(published.body.locations[0]).toEqual(expect.objectContaining({
      branding: expect.objectContaining({ accentColor: "#fe2c54" }),
      adminBranding: expect.objectContaining({ accentColor: "#4c7dff", backgroundColor: "#10131a" }),
      brandingDraft: null,
    }));

    const publicAdminBranding = await request(app.getHttpServer())
      .get(`/api/v1/cinema/admin-branding?locationId=${locationId}`)
      .expect(200);
    expect(publicAdminBranding.body).toEqual(expect.objectContaining({
      name: "Meridian Cinema",
      accentColor: "#4c7dff",
      backgroundColor: "#10131a",
    }));

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: "Forbidden rename" })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}/locations/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ active: false })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}/locations/${locationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ preShowBufferMinutes: 30, timeClockEnabled: true })
      .expect(200);
  });

  it("suspends a client across staff and customer access without changing location status", async () => {
    const overview = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);
    const meridian = overview.body.organizations.find(
      (organization: { name: string }) => organization.name === "Meridian Cinema Co.",
    );
    const organizationId = meridian.id as string;
    const locationId = meridian.locations[0].id as string;
    const locationWasActive = meridian.locations[0].active as boolean;

    const suspended = await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ active: false })
      .expect(200);
    expect(suspended.body.active).toBe(false);
    expect(suspended.body.locations[0].active).toBe(locationWasActive);

    await request(app.getHttpServer())
      .get(`/api/v1/cinema/branding?locationId=${locationId}`)
      .expect(404);
    await request(app.getHttpServer())
      .get("/api/v1/auth/staff/me")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `owner@${SEED_SUFFIX}`, password: SEED_PASSWORD })
      .expect(401);

    const reactivated = await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ active: true })
      .expect(200);
    expect(reactivated.body.active).toBe(true);
    expect(reactivated.body.locations[0].active).toBe(locationWasActive);
    const loginAgain = await loginOwner();
    ownerAccessToken = loginAgain.body.accessToken;
    ownerRefreshToken = loginAgain.body.refreshToken;
  });

  it("issues audited, location-scoped support sessions that cannot mutate cinema data", async () => {
    const overview = await request(app.getHttpServer()).get("/api/v1/platform/overview").set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    const meridian = overview.body.organizations.find((organization: { name: string }) => organization.name === "Meridian Cinema Co.");
    const support = await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${meridian.id}/locations/${meridian.locations[0].id}/support-session`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(201);
    expect(support.body).toEqual(expect.objectContaining({ accessToken: expect.any(String), expiresInSeconds: 900 }));

    const profile = await request(app.getHttpServer()).get("/api/v1/auth/staff/me").set("Authorization", `Bearer ${support.body.accessToken}`).expect(200);
    expect(profile.body).toEqual(expect.objectContaining({ name: expect.stringContaining("Attend Support"), locationId: meridian.locations[0].id, supportSession: true }));
    await request(app.getHttpServer()).get("/api/v1/management/settings").set("Authorization", `Bearer ${support.body.accessToken}`).expect(200);
    await request(app.getHttpServer()).patch("/api/v1/management/settings/location").set("Authorization", `Bearer ${support.body.accessToken}`).send({ name: "Forbidden support edit" }).expect(403);

    const audit = await request(app.getHttpServer()).get("/api/v1/platform/audit-events?action=platform.support_session_created").set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    expect(audit.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ action: "platform.support_session_created", entityId: meridian.locations[0].id })]));
  });

  it("creates hosted Stripe onboarding and derives payment status from the connected account", async () => {
    const overview = await request(app.getHttpServer())
      .get("/api/v1/platform/overview")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200);
    const meridian = overview.body.organizations.find(
      (organization: { name: string }) => organization.name === "Meridian Cinema Co.",
    );
    expect(meridian).toBeDefined();
    const organizationId = meridian.id as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${organizationId}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ onboardingStatus: "COMPLETE" })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/connect/onboarding-link`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ origin: "http://localhost:3004" })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/connect/onboarding-link`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ origin: "https://attacker.example" })
      .expect(400);

    const link = await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/connect/onboarding-link`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ origin: "http://localhost:3004", returnPath: "/payments" })
      .expect(201);
    expect(link.body.url).toContain(`organizationId=${organizationId}`);
    expect(link.body.url).toContain("/payments?");
    expect(link.body.url).toContain("connect=return");

    await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/connect/onboarding-link`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ origin: "http://localhost:3004", returnPath: "/not-allowed" })
      .expect(400);

    const refreshed = await request(app.getHttpServer())
      .post(`/api/v1/platform/organizations/${organizationId}/connect/refresh`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(201);
    expect(refreshed.body.payments).toEqual({ connected: true, onboardingStatus: "COMPLETE" });

    const { prisma } = await import("@cinema/database");
    const audit = await prisma.auditEvent.findFirst({ where: { actorType: "PLATFORM", action: "platform.connect_status_refreshed", entityId: organizationId }, orderBy: { occurredAt: "desc" } });
    expect(audit?.afterState).toEqual(expect.objectContaining({ onboardingStatus: "COMPLETE", chargesEnabled: true, payoutsEnabled: true }));
  });

  it("rejects an Attend operator token from cinema staff routes", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/staff/me")
      .set("Authorization", `Bearer ${platformAccessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});

describe("RBAC permission enforcement", () => {
  it("allows the Owner (has audit.log.view) to list audit events", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/audit-events")
      .set("Authorization", `Bearer ${ownerAccessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The Owner's own login/logout actions above should have been recorded.
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("pages through audit events without repeating the first row", async () => {
    const first = await request(app.getHttpServer())
      .get("/api/v1/audit-events?limit=1")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get("/api/v1/audit-events?limit=1&offset=1")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);

    expect(first.body).toHaveLength(1);
    expect(second.body).toHaveLength(1);
    expect(second.body[0].id).not.toBe(first.body[0].id);
  });

  it("creates a venue-specific role and configures its permissions", async () => {
    const name = `Floor manager ${crypto.randomUUID()}`;
    const created = await request(app.getHttpServer())
      .post("/api/v1/management/roles")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name })
      .expect(201);

    expect(created.body.name).toBe(name);
    expect(created.body.key).toMatch(/^CUSTOM_[A-F0-9]{32}$/);
    await request(app.getHttpServer())
      .patch(`/api/v1/management/roles/${created.body.id}/permissions`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ permissionKeys: ["showtime.manage", "ticket.refund"] })
      .expect(200);
    const people = await request(app.getHttpServer())
      .get("/api/v1/management/people")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(people.body.roles.find((role: { id: string }) => role.id === created.body.id).rolePermissions.map((entry: { permission: { key: string } }) => entry.permission.key).sort()).toEqual(["showtime.manage", "ticket.refund"]);
    const renamed = `${name} renamed`;
    await request(app.getHttpServer())
      .patch(`/api/v1/management/roles/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: renamed })
      .expect(200)
      .expect(({ body }) => expect(body.name).toBe(renamed));
    await request(app.getHttpServer())
      .delete(`/api/v1/management/roles/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ id: created.body.id, deleted: true }));
    const builtInRole = people.body.roles.find((role: { key: string }) => !role.key.startsWith("CUSTOM_"));
    await request(app.getHttpServer())
      .delete(`/api/v1/management/roles/${builtInRole.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(403);
  });

  it("rejects a Server (lacks audit.log.view) from listing audit events, even with a valid session (403)", async () => {
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.employee.permissions).not.toContain("audit.log.view");

    const res = await request(app.getHttpServer())
      .get("/api/v1/audit-events")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});

describe("Milestone 1 cinema configuration", () => {
  let auditoriumId: string;
  let movieId: string;
  let firstShowtimeId: string;
  let secondShowtimeId: string;

  it("creates an auditorium with a validated paired seat map", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Integration Theater",
        seatMapName: "Integration paired layout",
        seats: [
          { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD", tableGroupId: "A-1", tablePosition: "LEFT" },
          { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD", tableGroupId: "A-1", tablePosition: "RIGHT" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.capacity).toBe(2);
    expect(res.body.seatMap.seats).toHaveLength(2);
    auditoriumId = res.body.id;
  });

  it("rejects a duplicate seat label before writing the auditorium", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Invalid Theater",
        seatMapName: "Invalid",
        seats: [
          { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD" },
          { label: "a1", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("creates a movie", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Integration Feature", runtimeMinutes: 120, rating: "PG-13" });
    expect(res.status).toBe(201);
    expect(res.body.runtimeMinutes).toBe(120);
    movieId = res.body.id;
  });

  it("creates a showtime and computes pre-show, film end, and room-ready times", async () => {
    const startsAt = "2030-01-01T18:00:00.000Z";
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId, auditoriumId, startsAt });
    expect(res.status).toBe(201);
    expect(res.body.onSale).toBe(true);
    expect(res.body.priceTier.id).toBeTruthy();
    expect(res.body.featureStartsAt).toBe("2030-01-01T18:30:00.000Z");
    expect(res.body.endsAt).toBe("2030-01-01T20:30:00.000Z");
    expect(res.body.roomReadyAt).toBe("2030-01-01T20:45:00.000Z");
    firstShowtimeId = res.body.id;
  });

  it("versions an advanced layout without changing seats on an existing showtime", async () => {
    const { prisma } = await import("@cinema/database");
    const before = await prisma.showtimeSeat.findMany({ where: { showtimeId: firstShowtimeId }, orderBy: { seatId: "asc" } });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cinema/auditoriums/${auditoriumId}/layout`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Integration Theater",
        seatMapName: "Integration advanced layout",
        layout: {
          mode: "ADVANCED", canvas: { width: 12, height: 8 }, screenPosition: "TOP", seatingStyle: "SINGLE",
          levels: [{ id: "main", name: "Main floor", sortOrder: 0 }], sections: [],
          elements: [{ id: "center-aisle", type: "AISLE", levelId: "main", x: 1, y: 0, width: 1, height: 2 }],
        },
        seats: [
          { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "ADA", levelKey: "main" },
          { label: "A2", rowLabel: "A", number: 2, x: 2, y: 0, type: "COMPANION", levelKey: "main" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.seatMap.version).toBe(2);
    expect(res.body.seatMap.seats.every((seat: { layoutVersion: number }) => seat.layoutVersion === 2)).toBe(true);
    const after = await prisma.showtimeSeat.findMany({ where: { showtimeId: firstShowtimeId }, orderBy: { seatId: "asc" } });
    expect(after.map((seat) => seat.seatId)).toEqual(before.map((seat) => seat.seatId));
    expect(await prisma.seat.count({ where: { seatMap: { auditoriumId }, layoutVersion: 1, active: false } })).toBe(2);
  });

  it("rejects a showtime before the 15-minute cleaning window has passed", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId, auditoriumId, startsAt: "2030-01-01T20:44:00.000Z", onSale: false });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("accepts a showtime starting exactly when the room is ready", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId, auditoriumId, startsAt: "2030-01-01T20:45:00.000Z", onSale: true });
    expect(res.status).toBe(201);
    secondShowtimeId = res.body.id;
  });

  it("moves a showtime while preserving computed turnover timing", async () => {
    const { prisma } = await import("@cinema/database");
    const before = await prisma.showtime.findUniqueOrThrow({ where: { id: secondShowtimeId } });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cinema/showtimes/${secondShowtimeId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ startsAt: "2030-01-02T18:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.featureStartsAt).toBe("2030-01-02T18:30:00.000Z");
    expect(res.body.roomReadyAt).toBe("2030-01-02T20:45:00.000Z");
    expect(res.body.priceTier.id).toBe(before.priceTierId);
    const after = await prisma.showtime.findUniqueOrThrow({ where: { id: secondShowtimeId } });
    expect(after.priceTierId).toBe(before.priceTierId);
  });

  it("includes the required price tier relation in the admin schedule", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    const showtime = res.body.showtimes.find((item: { id: string }) => item.id === secondShowtimeId);
    expect(showtime.priceTier.id).toBeTruthy();
  });

  it("lists active film series with their explicitly assigned future showtimes", async () => {
    const series = await request(app.getHttpServer())
      .post("/api/v1/cinema/film-series")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Public Classics",
        description: "A managed repertory program.",
        artworkUrl: "https://example.com/public-classics.jpg",
      });
    expect(series.status).toBe(201);

    const assigned = await request(app.getHttpServer())
      .patch(`/api/v1/cinema/showtimes/${secondShowtimeId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ filmSeriesId: series.body.id, presentation: "Q_AND_A" });
    expect(assigned.status).toBe(200);

    const res = await request(app.getHttpServer()).get("/api/v1/cinema/film-series");
    expect(res.status).toBe(200);
    const publicSeries = res.body.series.find((entry: { id: string }) => entry.id === series.body.id);
    expect(publicSeries).toEqual(expect.objectContaining({
      name: "Public Classics",
      description: "A managed repertory program.",
      artworkUrl: "https://example.com/public-classics.jpg",
    }));
    const movie = publicSeries.movies.find((entry: { id: string }) => entry.id === movieId);
    expect(movie.title).toBe("Integration Feature");
    expect(movie.showtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: secondShowtimeId, presentation: "Q_AND_A" }),
    ]));
  });

  it("lists real on-sale showtimes publicly", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/cinema/now-playing");
    expect(res.status).toBe(200);
    expect(res.body.location).toEqual(expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      timezone: expect.any(String),
    }));
    expect(res.body.location).toHaveProperty("address");
    expect(res.body.movies.some((movie: { title: string }) => movie.title === "Integration Feature")).toBe(true);
  });

  it("lets authorized cinema managers update location-scoped branding", async () => {
    const updated = await request(app.getHttpServer())
      .patch("/api/v1/management/settings/branding")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: "Integration Cinema", logoUrl: "https://example.com/cinema.svg", accentColor: "#123456", backgroundColor: "#101112", textColor: "#fefefe", adminAccentColor: "#654321" });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual(expect.objectContaining({ name: "Integration Cinema", customerLogoUrl: "https://example.com/cinema.svg", customerAccentColor: "#123456", adminAccentColor: "#654321" }));
  });

  it("validates cinema-managed branding colors", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/management/settings/branding")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ accentColor: "hotpink" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("lets cinema managers update audited operating settings", async () => {
    const current = await request(app.getHttpServer())
      .get("/api/v1/management/settings")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(current.status).toBe(200);

    const update = {
      name: current.body.name,
      address: current.body.address,
      timezone: current.body.timezone,
      ticketTaxRateBasisPoints: 925,
      preShowBufferMinutes: 25,
      cleaningBufferMinutes: 20,
      checkDropMinutesBeforeEnd: 35,
      autoSettleGraceMinutes: 10,
      autoSettleTipBasisPoints: 1800,
      timeClockEnabled: false,
    };
    const updated = await request(app.getHttpServer())
      .patch("/api/v1/management/settings/location")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send(update);
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual(expect.objectContaining(update));

    const audit = await request(app.getHttpServer())
      .get("/api/v1/audit-events?action=location.settings_updated&limit=1")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body[0].afterState).toEqual(expect.objectContaining({ cleaningBufferMinutes: 20, autoSettleTipBasisPoints: 1800 }));

    await request(app.getHttpServer())
      .patch("/api/v1/management/settings/location")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        ticketTaxRateBasisPoints: current.body.ticketTaxRateBasisPoints,
        preShowBufferMinutes: current.body.preShowBufferMinutes,
        cleaningBufferMinutes: current.body.cleaningBufferMinutes,
        checkDropMinutesBeforeEnd: current.body.checkDropMinutesBeforeEnd,
        autoSettleGraceMinutes: current.body.autoSettleGraceMinutes,
        autoSettleTipBasisPoints: current.body.autoSettleTipBasisPoints,
        timeClockEnabled: current.body.timeClockEnabled,
      });
  });

  it("lets cinema managers update an organization ticket price", async () => {
    const current = await request(app.getHttpServer())
      .get("/api/v1/management/settings")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(current.status).toBe(200);
    const tier = current.body.priceTiers[0];
    expect(tier).toEqual(expect.objectContaining({
      id: expect.any(String),
      ticketPriceMinor: expect.any(Number),
    }));

    const ticketPriceMinor = tier.ticketPriceMinor + 25;
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/price-tiers/${tier.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketPriceMinor });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual(expect.objectContaining({
      id: tier.id,
      ticketPriceMinor,
    }));

    const audit = await request(app.getHttpServer())
      .get(`/api/v1/audit-events?action=ticket.price_tier_updated&entityId=${tier.id}&limit=1`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body[0]).toEqual(expect.objectContaining({
      action: "ticket.price_tier_updated",
      entityId: tier.id,
    }));

    await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/price-tiers/${tier.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketPriceMinor: tier.ticketPriceMinor });
  });

  it("lets cinema managers create an organization ticket price", async () => {
    const name = `Integration price ${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post("/api/v1/management/settings/price-tiers")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name, ticketPriceMinor: 2000 });
    expect(created.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({
      id: expect.any(String),
      name,
      ticketPriceMinor: 2000,
      appliesOnWeekdays: [],
      active: true,
    }));

    const audit = await request(app.getHttpServer())
      .get(`/api/v1/audit-events?action=ticket.price_tier_created&entityId=${created.body.id}&limit=1`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body[0]).toEqual(expect.objectContaining({
      action: "ticket.price_tier_created",
      entityId: created.body.id,
    }));

    await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/price-tiers/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketPriceMinor: 2000, active: false });
  });

  it("lets managers update and deactivate restaurant charge rules", async () => {
    const tax = await request(app.getHttpServer())
      .post("/api/v1/management/settings/tax-rules")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Integration tax ${Date.now()}`, appliesTo: "FOOD", ratePermille: 90, active: true });
    expect(tax.status).toBe(201);

    const updatedTax = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/tax-rules/${tax.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ratePermille: 95, active: false });
    expect(updatedTax.status).toBe(200);
    expect(updatedTax.body).toEqual(expect.objectContaining({ ratePermille: 95, active: false }));

    const serviceCharge = await request(app.getHttpServer())
      .post("/api/v1/management/settings/service-charge-rules")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Integration service ${Date.now()}`, appliesTo: "ALL", ratePermille: 180, autoApply: true, active: true });
    expect(serviceCharge.status).toBe(201);

    const updatedServiceCharge = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/service-charge-rules/${serviceCharge.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ autoApply: false, active: false });
    expect(updatedServiceCharge.status).toBe(200);
    expect(updatedServiceCharge.body).toEqual(expect.objectContaining({ autoApply: false, active: false }));

    const taxAudit = await request(app.getHttpServer())
      .get("/api/v1/audit-events?action=tax_rule.updated&limit=1")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(taxAudit.status).toBe(200);
    expect(taxAudit.body[0]).toEqual(expect.objectContaining({ action: "tax_rule.updated", entityId: tax.body.id }));

    const serviceAudit = await request(app.getHttpServer())
      .get("/api/v1/audit-events?action=service_charge_rule.updated&limit=1")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(serviceAudit.status).toBe(200);
    expect(serviceAudit.body[0]).toEqual(expect.objectContaining({ action: "service_charge_rule.updated", entityId: serviceCharge.body.id }));
  });

  it("lets managers deactivate and reactivate promotions with an audit trail", async () => {
    const promotion = await request(app.getHttpServer())
      .post("/api/v1/management/settings/promotions")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ code: `LIFE${Date.now()}`, name: "Integration lifecycle", type: "PERCENTAGE", percentageBasisPoints: 1500, minimumSubtotalCents: 2500, maximumRedemptions: 20, active: true });
    expect(promotion.status).toBe(201);
    expect(promotion.body).toEqual(expect.objectContaining({ minimumSubtotalCents: 2500, maximumRedemptions: 20 }));

    const deactivated = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/promotions/${promotion.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toEqual(expect.objectContaining({ active: false, percentageBasisPoints: 1500 }));

    const reactivated = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/promotions/${promotion.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ active: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.active).toBe(true);

    const audit = await request(app.getHttpServer())
      .get("/api/v1/audit-events?action=promotion.updated&limit=2")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.filter((event: { entityId: string }) => event.entityId === promotion.body.id)).toHaveLength(2);
  });

  it("reports paid promotion redemptions, discounted tickets, and discount totals", async () => {
    const promotion = await request(app.getHttpServer())
      .post("/api/v1/management/settings/promotions")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ code: `REPORT${Date.now()}`, name: "Integration reporting", type: "FIXED_AMOUNT", amountCents: 777, active: true });
    expect(promotion.status).toBe(201);

    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findUniqueOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const showtimeSeat = await prisma.showtimeSeat.findFirstOrThrow({
      where: { showtime: { auditorium: { locationId: owner.locationId } }, tickets: { none: {} } },
    });
    await prisma.ticketOrder.create({
      data: {
        locationId: owner.locationId,
        ticketTypeId: ticketType.id,
        holdTokens: [],
        holderKey: crypto.randomUUID(),
        status: "PAID",
        orderNumber: `PROMO-${crypto.randomUUID()}`,
        checkoutIdempotencyKey: crypto.randomUUID(),
        subtotalCents: 2000,
        feesCents: 0,
        taxCents: 0,
        totalCents: 2000,
        promotionId: promotion.body.id,
        discountCents: 777,
        tickets: { create: { showtimeSeatId: showtimeSeat.id, ticketTypeId: ticketType.id, priceCentsPaid: 1223, qrToken: `promo-${crypto.randomUUID()}` } },
      },
    });

    const settings = await request(app.getHttpServer())
      .get("/api/v1/management/settings")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(settings.status).toBe(200);
    expect(settings.body.promotions.find((item: { id: string }) => item.id === promotion.body.id)).toEqual(
      expect.objectContaining({ redemptionCount: 1, discountedTicketCount: 1, totalDiscountCents: 777 }),
    );
  });

  it("orders movies in the public listing by their next upcoming showtime, not alphabetically by title", async () => {
    const zTitled = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Zzzchronological Early Show", runtimeMinutes: 90 });
    expect(zTitled.status).toBe(201);

    const aTitled = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Aaachronological Late Show", runtimeMinutes: 90 });
    expect(aTitled.status).toBe(201);

    // "Zzz..." (alphabetically last) plays first; "Aaa..." (alphabetically
    // first) plays later the same day -- the listing must reflect
    // showtime order, not title order.
    const earlyShowtime = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId: zTitled.body.id, auditoriumId, startsAt: "2030-02-01T14:00:00.000Z", onSale: true });
    expect(earlyShowtime.status).toBe(201);

    const lateShowtime = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId: aTitled.body.id, auditoriumId, startsAt: "2030-02-01T20:00:00.000Z", onSale: true });
    expect(lateShowtime.status).toBe(201);

    const res = await request(app.getHttpServer()).get("/api/v1/cinema/now-playing");
    expect(res.status).toBe(200);
    const titles: string[] = res.body.movies.map((movie: { title: string }) => movie.title);
    expect(titles.indexOf("Zzzchronological Early Show")).toBeLessThan(
      titles.indexOf("Aaachronological Late Show"),
    );
  });

  it("keeps a showtime that already started visible in the public listing instead of removing it", async () => {
    const { prisma } = await import("@cinema/database");

    const created = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId, auditoriumId, startsAt: "2030-02-05T18:00:00.000Z", onSale: true });
    expect(created.status).toBe(201);

    // Simulate the showtime having already started -- directly, since the
    // create endpoint itself won't accept a past startsAt.
    await prisma.showtime.update({
      where: { id: created.body.id },
      data: { startsAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer()).get("/api/v1/cinema/now-playing");
    expect(res.status).toBe(200);
    const listedShowtimeIds = res.body.movies.flatMap((movie: { showtimes: Array<{ id: string }> }) =>
      movie.showtimes.map((showtime) => showtime.id),
    );
    expect(listedShowtimeIds).toContain(created.body.id);
  });

  it("safely removes an untouched future showtime, then archives its movie and auditorium", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/auditoriums/${auditoriumId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(409);

    const auditorium = await request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Cleanup Theater",
        seatMapName: "Cleanup layout",
        seats: [{ label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD" }],
      })
      .expect(201);
    const movie = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Cleanup Feature", runtimeMinutes: 80 })
      .expect(201);
    const showtime = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ movieId: movie.body.id, auditoriumId: auditorium.body.id, startsAt: "2031-01-01T18:00:00.000Z", onSale: false })
      .expect(201);

    const { prisma } = await import("@cinema/database");
    const cleanupSeat = await prisma.showtimeSeat.findFirstOrThrow({
      where: { showtimeId: showtime.body.id },
    });
    const cleanupHold = await prisma.seatHold.create({
      data: {
        showtimeSeatId: cleanupSeat.id,
        holdToken: `cleanup-${Date.now()}`,
        holderKey: "cleanup-holder",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/showtimes/${showtime.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(409);
    await prisma.seatHold.update({
      where: { id: cleanupHold.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/showtimes/${showtime.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/auditoriums/${auditorium.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);

    const bootstrap = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(bootstrap.body.location.auditoriums.some((room: { id: string }) => room.id === auditorium.body.id)).toBe(false);
    expect(bootstrap.body.location.organization.movies.some((item: { id: string }) => item.id === movie.body.id)).toBe(false);
    expect(bootstrap.body.showtimes.some((item: { id: string }) => item.id === showtime.body.id)).toBe(false);
  });

  it("duplicates one day of programming to multiple dates with preserved pricing and fresh seat inventory", async () => {
    const auditorium = await request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        name: "Duplicate Day Theater",
        seatMapName: "Duplicate day layout",
        seats: [
          { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD" },
          { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD" },
        ],
      })
      .expect(201);
    const movie = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Duplicate Day Feature", runtimeMinutes: 90 })
      .expect(201);
    const sourceShowtime = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        movieId: movie.body.id,
        auditoriumId: auditorium.body.id,
        startsAt: "2031-02-10T18:00:00.000Z",
        onSale: false,
      })
      .expect(201);

    const duplicated = await request(app.getHttpServer())
      .post("/api/v1/cinema/showtimes/duplicate-day")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        sourceDate: "2031-02-10",
        targetDates: ["2031-02-12", "2031-02-13"],
        saleStatus: "ON_SALE",
      })
      .expect(201);

    expect(duplicated.body.createdCount).toBe(2);
    expect(duplicated.body.showtimes).toHaveLength(2);
    expect(duplicated.body.showtimes.every((showtime: { onSale: boolean }) => showtime.onSale)).toBe(true);
    expect(
      duplicated.body.showtimes.every(
        (showtime: { priceTier: { id: string } }) => showtime.priceTier.id === sourceShowtime.body.priceTier.id,
      ),
    ).toBe(true);
    expect(duplicated.body.showtimes.map((showtime: { startsAt: string }) => showtime.startsAt)).toEqual([
      "2031-02-12T18:00:00.000Z",
      "2031-02-13T18:00:00.000Z",
    ]);

    const { prisma } = await import("@cinema/database");
    for (const showtime of duplicated.body.showtimes as Array<{ id: string }>) {
      expect(await prisma.showtimeSeat.count({ where: { showtimeId: showtime.id } })).toBe(2);
    }
  });

  it(
    "duplicates a production-sized day across multiple targets within the extended transaction window",
    async () => {
      const seats = Array.from({ length: 8 }, (_, rowIndex) =>
        Array.from({ length: 12 }, (_, seatIndex) => ({
          label: `${String.fromCharCode(65 + rowIndex)}${seatIndex + 1}`,
          rowLabel: String.fromCharCode(65 + rowIndex),
          number: seatIndex + 1,
          x: seatIndex,
          y: rowIndex,
          type: "STANDARD",
        })),
      ).flat();

      const auditoriums = [];
      for (let auditoriumIndex = 0; auditoriumIndex < 3; auditoriumIndex += 1) {
        const auditorium = await request(app.getHttpServer())
          .post("/api/v1/cinema/auditoriums")
          .set("Authorization", `Bearer ${ownerAccessToken}`)
          .send({
            name: `Production duplicate auditorium ${auditoriumIndex + 1}`,
            seatMapName: `Production duplicate seat map ${auditoriumIndex + 1}`,
            seats,
          })
          .expect(201);
        auditoriums.push(auditorium.body);
      }

      const movie = await request(app.getHttpServer())
        .post("/api/v1/cinema/movies")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          title: "Production Duplicate Feature",
          synopsis: "A production-sized duplicate-day regression fixture.",
          runtimeMinutes: 90,
          rating: "PG",
          status: "ACTIVE",
        })
        .expect(201);

      const sourceStarts = ["12:00:00.000Z", "15:00:00.000Z", "18:00:00.000Z", "21:00:00.000Z"];
      for (const auditorium of auditoriums) {
        for (const startsAt of sourceStarts) {
          await request(app.getHttpServer())
          .post("/api/v1/cinema/showtimes")
            .set("Authorization", `Bearer ${ownerAccessToken}`)
            .send({
              movieId: movie.body.id,
              auditoriumId: auditorium.id,
              startsAt: `2031-03-10T${startsAt}`,
              basePriceCents: 1700,
              onSale: true,
            })
            .expect(201);
        }
      }

      const duplicated = await request(app.getHttpServer())
        .post("/api/v1/cinema/showtimes/duplicate-day")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          sourceDate: "2031-03-10",
          targetDates: ["2031-03-12", "2031-03-13"],
          saleStatus: "PRESERVE",
        })
        .expect(201);

      expect(duplicated.body.createdCount).toBe(24);
      expect(duplicated.body.showtimes).toHaveLength(24);

      const { prisma } = await import("@cinema/database");
      const duplicatedIds = duplicated.body.showtimes.map((showtime: { id: string }) => showtime.id);
      expect(
        await prisma.showtimeSeat.count({
          where: { showtimeId: { in: duplicatedIds } },
        }),
      ).toBe(24 * 96);
    },
    60_000,
  );

  it("keeps archived movies in the Film Library and allows restoring them", async () => {
    const movie = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Restorable Feature", runtimeMinutes: 95 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);

    const archived = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(archived.body.location.organization.movies.some((item: { id: string }) => item.id === movie.body.id)).toBe(false);
    expect(archived.body.archivedMovies.some((item: { id: string }) => item.id === movie.body.id)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/cinema/movies/${movie.body.id}/restore`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(201);

    const restored = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(restored.body.location.organization.movies.some((item: { id: string }) => item.id === movie.body.id)).toBe(true);
    expect(restored.body.archivedMovies.some((item: { id: string }) => item.id === movie.body.id)).toBe(false);
  });

  it("permanently deletes an unused archived movie", async () => {
    const movie = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Disposable Feature", runtimeMinutes: 88 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}/permanent`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200)
      .expect({ deleted: true, id: movie.body.id });

    const bootstrap = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(bootstrap.body.archivedMovies.some((item: { id: string }) => item.id === movie.body.id)).toBe(false);
  });

  it("rejects a server role from creating a movie", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    const res = await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ title: "Unauthorized", runtimeMinutes: 90 });
    expect(res.status).toBe(403);
  });
});

describe("Milestone 2 concurrency-safe seat holds", () => {
  // Use tomorrow's first Theater 1 showtime so the hold command remains
  // future-dated regardless of what time the CI suite starts today.
  const showtimeId = "31000000-0000-0000-0002-000000000002";

  it("creates one authoritative inventory row per seat", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(96);
    expect(res.body.seats.every((seat: { state: string }) => seat.state === "AVAILABLE")).toBe(true);
    expect(res.body.counts).toEqual({ available: 96, held: 0, sold: 0, blocked: 0 });
  });

  it("allows exactly one winner when twelve guests hold the same seat concurrently", async () => {
    const availability = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    const seatId = availability.body.seats[0].id as string;
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(app.getHttpServer())
          .post(`/api/v1/cinema/showtimes/${showtimeId}/holds`)
          .send({
            seatIds: [seatId],
            holderKey: `concurrent-holder-${index.toString().padStart(3, "0")}`,
          }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === 201)).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 409)).toHaveLength(11);
  });

  it("returns all-or-nothing when a multi-seat hold includes an unavailable seat", async () => {
    const availability = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    const heldSeat = availability.body.seats.find((seat: { state: string }) => seat.state === "HELD");
    const availableSeat = availability.body.seats.find((seat: { state: string }) => seat.state === "AVAILABLE");
    const result = await request(app.getHttpServer())
      .post(`/api/v1/cinema/showtimes/${showtimeId}/holds`)
      .send({
        seatIds: [heldSeat.id, availableSeat.id],
        holderKey: "atomic-multi-seat-holder",
      });
    expect(result.status).toBe(409);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    expect(after.body.seats.find((seat: { id: string }) => seat.id === availableSeat.id).state)
      .toBe("AVAILABLE");
  });

  it("expires an abandoned hold and makes the seat available again", async () => {
    const { prisma } = await import("@cinema/database");
    const activeHold = await prisma.seatHold.findFirstOrThrow({
      where: { showtimeSeat: { showtimeId }, releasedAt: null },
    });
    await prisma.seatHold.update({
      where: { id: activeHold.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const afterExpiry = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    const inventory = await prisma.showtimeSeat.findUniqueOrThrow({
      where: { id: activeHold.showtimeSeatId },
    });
    expect(afterExpiry.body.seats.find((seat: { inventoryId: string }) => seat.inventoryId === inventory.id).state)
      .toBe("AVAILABLE");
    expect((await prisma.seatHold.findUniqueOrThrow({ where: { id: activeHold.id } })).releasedAt)
      .not.toBeNull();
  });
});

describe("Milestone 3 ticket checkout and payment recovery", () => {
  const showtimeId = "31000000-0000-0000-0002-000000000002";

  async function holdAvailableSeat(holderKey: string) {
    const availability = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    const seat = availability.body.seats.find(
      (candidate: { state: string }) => candidate.state === "AVAILABLE",
    );
    expect(seat).toBeDefined();
    const hold = await request(app.getHttpServer())
      .post(`/api/v1/cinema/showtimes/${showtimeId}/holds`)
      .send({ seatIds: [seat.id], holderKey });
    expect(hold.status).toBe(201);
    return { seat, hold: hold.body[0] as { holdToken: string } };
  }

  async function createCheckout(holderKey: string, holdToken: string) {
    const { prisma } = await import("@cinema/database");
    const showtime = await prisma.showtime.findUniqueOrThrow({
      where: { id: showtimeId },
      select: { priceTier: { select: { ticketPriceMinor: true, feeMinor: true } } },
    });
    const config = await request(app.getHttpServer()).get(
      `/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`,
    );
    expect(config.status).toBe(200);
    const result = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: [holdToken],
        holderKey,
        ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`,
        diningAuthorizationRequested: true,
      });
    expect(result.status).toBe(201);
    expect(result.body.subtotalCents).toBe(showtime.priceTier.ticketPriceMinor);
    expect(result.body.feesCents).toBe(showtime.priceTier.feeMinor);
    expect(result.body.taxCents).toBe(0);
    return result.body as {
      orderId: string;
      orderNumber: string;
      payment: { providerPaymentId: string };
    };
  }

  it("issues one ticket after a verified successful payment and is idempotent", async () => {
    const holderKey = "ticket-happy-holder-0001";
    const { seat, hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");

    const first = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body.status).toBe("PAID");
    expect(first.body.tickets).toHaveLength(1);
    milestone4Credential = first.body.tickets[0].issuanceToken;
    milestone4TicketId = first.body.tickets[0].id;
    expect(replay.body.tickets[0].id).toBe(first.body.tickets[0].id);

    const after = await request(app.getHttpServer()).get(
      `/api/v1/cinema/showtimes/${showtimeId}/seats`,
    );
    expect(
      after.body.seats.find(
        (candidate: { id: string }) => candidate.id === seat.id,
      ).state,
    ).toBe("SOLD");
  });

  it("recovers a successful payment through a replay-safe webhook", async () => {
    const holderKey = "ticket-webhook-holder-0002";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_ticket_success_0002",
        type: "payment_intent.succeeded",
        paymentIntentId: checkout.payment.providerPaymentId,
      }),
    );
    const signature = provider.signWebhook(raw);

    const first = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw.toString());
    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.duplicate).toBe(true);

    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
  });

  it("allows a declined payment intent to be retried without losing the held seat", async () => {
    const holderKey = "ticket-retry-holder-0003";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setIntentStatus(checkout.payment.providerPaymentId, "FAILED");
    const declined = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(declined.status).toBe(402);

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    const retried = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(retried.status).toBe(201);
    expect(retried.body.status).toBe("PAID");
  });

  it("automatically refunds a successful payment when its seat hold has expired", async () => {
    const holderKey = "ticket-expired-holder-0004";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setRefundFailure(null);
    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0].status).toBe("SUCCEEDED");
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(0);
  });

  it("records an operational alert when an automatic refund fails", async () => {
    const holderKey = "ticket-refund-alert-0005";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setRefundFailure("simulated processor outage");
    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "payment.refund_attention_required",
          entityType: "Refund",
        },
      }),
    ).toBeGreaterThan(0);
    provider.setRefundFailure(null);
  });

  it("treats an ambiguous (non-definitive) refund failure as retryable, not a confirmed rejection, and resolves it durably via the reconciliation sweep -- not the customer's original request", async () => {
    const holderKey = "ticket-ambiguous-refund-0006";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const { TicketingService } = await import("../src/ticketing/ticketing.service");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const ticketingService = app.get(TicketingService);

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    provider.makeRefundsFailAmbiguously();
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const afterFailure = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    // A network/5xx-style failure must never be recorded as a confirmed
    // rejection -- the true outcome is unknown. Payment stays SUCCEEDED
    // (never REFUNDED on a guess), the Refund row is left exactly as it
    // was (CREATED, not FAILED) so the next reconciliation pass revisits
    // it, and no operational alert fires for something that isn't
    // actually a confirmed failure yet.
    expect(afterFailure.status).toBe(PaymentStatus.SUCCEEDED);
    expect(afterFailure.refunds).toHaveLength(1);
    expect(afterFailure.refunds[0].status).toBe(RefundStatus.CREATED);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "payment.refund_attention_required",
          entityType: "Refund",
          entityId: afterFailure.refunds[0].id,
        },
      }),
    ).toBe(0);

    // The provider recovers. Nothing about the customer's original
    // request retries this -- only the durable reconciliation sweep does.
    provider.stopFailingRefunds();
    const sweep = await ticketingService.reconcilePendingRefunds();
    expect(sweep.reconciled).toBeGreaterThan(0);

    const afterReconcile = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(afterReconcile.status).toBe(PaymentStatus.REFUNDED);
    expect(afterReconcile.refunds[0].status).toBe(RefundStatus.SUCCEEDED);
  });

  it("reconstructs a missing Payment/PaymentAttempt link from a payment_intent.succeeded webhook's own metadata when completeCheckout's local write never committed", async () => {
    const holderKey = "ticket-crash-recovery-holder-0007";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");

    // Simulate the process dying after Stripe created/charged the
    // PaymentIntent but before completeCheckout's own write ever
    // committed locally -- the only thing that can recover this order
    // afterwards is a webhook, using data it independently carries.
    await prisma.payment.update({
      where: { ticketOrderId: checkout.orderId },
      data: { providerPaymentId: null },
    });
    await prisma.paymentAttempt.deleteMany({
      where: { payment: { ticketOrderId: checkout.orderId } },
    });

    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_ticket_crash_recovery_0007",
        type: "payment_intent.succeeded",
        paymentIntentId: checkout.payment.providerPaymentId,
        metadata: { ticketOrderId: checkout.orderId },
      }),
    );
    const signature = provider.signWebhook(raw);

    const res = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw.toString());

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
    });
    expect(payment.providerPaymentId).toBe(checkout.payment.providerPaymentId);
    expect(
      await prisma.paymentAttempt.count({ where: { paymentId: payment.id } }),
    ).toBe(1);
  });

  it("flags a durable review state when a succeeded PaymentIntent's metadata doesn't match the order, refuses to issue tickets, and self-heals once the mismatch is gone", async () => {
    const holderKey = "ticket-verification-mismatch-0008";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    provider.setIntentMetadata(checkout.payment.providerPaymentId, {
      ticketOrderId: "some-other-unrelated-order-id",
    });

    const mismatched = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(mismatched.status).toBe(409);
    expect(mismatched.body.code).toBe("CONFLICT");
    expect(mismatched.body.details?.reason).toBe("PAYMENT_VERIFICATION_FAILED");

    const flagged = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
    });
    expect(flagged.verificationFailedAt).not.toBeNull();
    expect(flagged.verificationFailureNote).toContain(checkout.orderId);
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(0);

    // The mismatch clears (e.g. it was a transient reporting error, or an
    // operator corrected it) -- the next finalize call re-verifies against
    // the provider itself, and finding a match this time, self-heals the
    // flag with no dedicated admin action required.
    provider.setIntentMetadata(checkout.payment.providerPaymentId, {
      ticketOrderId: checkout.orderId,
    });

    const healed = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(healed.status).toBe(201);
    expect(healed.body.status).toBe("PAID");

    const cleared = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
    });
    expect(cleared.verificationFailedAt).toBeNull();
    expect(cleared.verificationFailureNote).toBeNull();
  });

  it("never downgrades a completed refund back to SUCCEEDED on a repeated finalize/recovery call", async () => {
    const holderKey = "ticket-refund-no-downgrade-0009";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const first = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(first.status).toBe(409);

    const afterFirstRefund = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(afterFirstRefund.status).toBe(PaymentStatus.REFUNDED);
    expect(afterFirstRefund.refunds[0].status).toBe(RefundStatus.SUCCEEDED);

    // A repeated finalize call (a redelivered webhook, a customer retry)
    // hits the SAME expired hold again and re-enters recovery -- it must
    // never overwrite the already-completed refund's REFUNDED status back
    // to SUCCEEDED.
    const second = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(second.status).toBe(409);

    const afterSecond = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(afterSecond.status).toBe(PaymentStatus.REFUNDED);
    expect(afterSecond.refunds).toHaveLength(1);
    expect(afterSecond.refunds[0].status).toBe(RefundStatus.SUCCEEDED);
  });

  it("acquires an exclusive claim before calling the refund provider, so two concurrent recovery attempts for the same payment never both call it", async () => {
    const holderKey = "ticket-concurrent-refund-claim-0010";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const { TicketingService } = await import("../src/ticketing/ticketing.service");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const ticketingService = app.get(TicketingService);

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
        .send({}),
    ]);
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);

    // Both requests raced into recovery for the SAME payment -- only the
    // one that actually won the exclusive lease claim may have ever
    // called the provider. Without the claim, upsert's get-or-create
    // alone lets both callers think they own the row.
    const refundCallsForThisPayment = provider.refundCalls.filter(
      (call) => call.providerPaymentId === checkout.payment.providerPaymentId,
    );
    expect(refundCallsForThisPayment).toHaveLength(1);

    // Two concurrent transactions racing to lock overlapping rows (the
    // TicketOrder, the Refund row's unique idempotencyKey) can
    // occasionally have Postgres abort one side with a genuine deadlock
    // -- settleRefund already treats a persist failure that happens AFTER
    // a successful provider call as safely retryable (never FAILED,
    // never lost), leaving the row PROCESSING until the next
    // reconciliation pass observes and records the SAME real outcome.
    // That is the exact scenario being exercised here under real
    // concurrent load, so give it that one retry rather than asserting
    // persistence always lands on the very first attempt.
    let payment = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    if (payment.refunds[0].status !== RefundStatus.SUCCEEDED) {
      // A rolled-back persist attempt leaves the winning claim's own
      // lease (60s) intact, since the transaction that would have
      // cleared it never committed -- fast-forward reconciliation's
      // notion of "now" past that lease instead of waiting it out.
      await ticketingService.reconcilePendingRefunds({ now: new Date(Date.now() + 120_000) });
      payment = await prisma.payment.findFirstOrThrow({
        where: { ticketOrderId: checkout.orderId },
        include: { refunds: true },
      });
    }
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0].status).toBe(RefundStatus.SUCCEEDED);
  });

  it("does not let a stale/out-of-order payment_intent webhook downgrade an already-finalized purchase", async () => {
    const holderKey = "ticket-stale-webhook-0011";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, TicketOrderStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    const finalize = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(finalize.status).toBe(201);
    expect(finalize.body.status).toBe("PAID");

    // A delayed/redelivered payment_intent.payment_failed webhook arrives
    // AFTER the order already finalized successfully -- it must be a
    // no-op, not a downgrade of an already-resolved order/payment.
    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_stale_failure_0011",
        type: "payment_intent.payment_failed",
        paymentIntentId: checkout.payment.providerPaymentId,
      }),
    );
    const signature = provider.signWebhook(raw);
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.duplicate).toBe(false);

    const order = await prisma.ticketOrder.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { payment: true },
    });
    expect(order.status).toBe(TicketOrderStatus.PAID);
    expect(order.payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
  });

  it("creates an operational alert when the provider returns (rather than throws) a terminal FAILED refund result", async () => {
    const holderKey = "ticket-returned-failed-refund-0012";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, RefundStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    provider.makeRefundsReturnStatus("FAILED");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(payment.refunds[0].status).toBe(RefundStatus.FAILED);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "payment.refund_attention_required",
          entityType: "Refund",
          entityId: payment.refunds[0].id,
        },
      }),
    ).toBe(1);

    provider.makeRefundsReturnStatus("SUCCEEDED");
  });

  it("creates an operational alert when an async refund.updated webhook reports a terminal FAILED refund", async () => {
    const holderKey = "ticket-webhook-failed-refund-0013";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, RefundStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    // Provider reports the refund still PENDING at creation time -- it
    // settles asynchronously via a later refund.updated webhook, the same
    // way a real ACH refund would.
    provider.makeRefundsReturnStatus("PENDING");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const pending = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(pending.refunds[0].status).toBe(RefundStatus.PROCESSING);
    const localRefundId = pending.refunds[0].id;
    const providerRefundId = pending.refunds[0].providerRefundId as string;

    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_refund_webhook_failed_0013",
        type: "refund.updated",
        refund: {
          providerRefundId,
          status: "FAILED",
          metadata: { refundId: localRefundId },
        },
      }),
    );
    const signature = provider.signWebhook(raw);
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);

    const afterWebhook = await prisma.refund.findUniqueOrThrow({
      where: { id: localRefundId },
    });
    expect(afterWebhook.status).toBe(RefundStatus.FAILED);
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "payment.refund_attention_required",
          entityType: "Refund",
          entityId: localRefundId,
        },
      }),
    ).toBe(1);

    provider.makeRefundsReturnStatus("SUCCEEDED");
  });

  it("does not let a stale/contradicting webhook overwrite an already-SUCCEEDED refund back to FAILED", async () => {
    const holderKey = "ticket-refund-race-succeeded-first-0014";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    // Provider reports PENDING at creation -- settles via webhook, giving
    // us a known providerRefundId to reference from a second, contradicting
    // webhook below.
    provider.makeRefundsReturnStatus("PENDING");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const pending = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    const localRefundId = pending.refunds[0].id;
    const providerRefundId = pending.refunds[0].providerRefundId as string;

    // First report: the refund genuinely succeeded.
    const successRaw = Buffer.from(
      JSON.stringify({
        id: "evt_test_refund_race_success_0014",
        type: "refund.updated",
        refund: { providerRefundId, status: "SUCCEEDED", metadata: { refundId: localRefundId } },
      }),
    );
    const successRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(successRaw))
      .set("Content-Type", "application/json")
      .send(successRaw.toString());
    expect(successRes.status).toBe(201);

    const afterSuccess = await prisma.refund.findUniqueOrThrow({ where: { id: localRefundId } });
    expect(afterSuccess.status).toBe(RefundStatus.SUCCEEDED);

    // Second, contradicting report arrives late (a redelivery of a
    // different event, a stale processor report) claiming the SAME refund
    // FAILED -- the already-recorded SUCCEEDED outcome must win.
    const failureRaw = Buffer.from(
      JSON.stringify({
        id: "evt_test_refund_race_stale_failure_0014",
        type: "refund.updated",
        refund: { providerRefundId, status: "FAILED", metadata: { refundId: localRefundId } },
      }),
    );
    const failureRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(failureRaw))
      .set("Content-Type", "application/json")
      .send(failureRaw.toString());
    expect(failureRes.status).toBe(201);

    const afterStaleFailure = await prisma.refund.findUniqueOrThrow({ where: { id: localRefundId } });
    expect(afterStaleFailure.status).toBe(RefundStatus.SUCCEEDED);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);

    // The stale contradicting report must not raise a false alert either
    // -- the true, correctly-recorded outcome was SUCCEEDED all along.
    expect(
      await prisma.auditEvent.count({
        where: { action: "payment.refund_attention_required", entityType: "Refund", entityId: localRefundId },
      }),
    ).toBe(0);

    provider.makeRefundsReturnStatus("SUCCEEDED");
  });

  it("does not let a stale/contradicting webhook overwrite an already-FAILED refund back to SUCCEEDED", async () => {
    const holderKey = "ticket-refund-race-failed-first-0015";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    provider.makeRefundsFail();
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const afterFailure = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    expect(afterFailure.status).toBe(PaymentStatus.SUCCEEDED);
    expect(afterFailure.refunds[0].status).toBe(RefundStatus.FAILED);
    const localRefundId = afterFailure.refunds[0].id;

    // A stale report arrives afterward claiming this SAME refund actually
    // succeeded (a redelivered/contradicting webhook) -- the already-
    // recorded FAILED outcome, which the operator has already been
    // alerted to, must not be overwritten.
    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_refund_race_stale_success_0015",
        type: "refund.updated",
        refund: {
          providerRefundId: "re_fake_unrelated_late_report",
          status: "SUCCEEDED",
          metadata: { refundId: localRefundId },
        },
      }),
    );
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(raw))
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);

    const afterStaleWebhook = await prisma.refund.findUniqueOrThrow({ where: { id: localRefundId } });
    expect(afterStaleWebhook.status).toBe(RefundStatus.FAILED);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: afterFailure.id } });
    expect(payment.status).toBe(PaymentStatus.SUCCEEDED);

    // Exactly one alert -- from the original genuine failure -- not a
    // second one from the stale contradicting report being (correctly)
    // rejected.
    expect(
      await prisma.auditEvent.count({
        where: { action: "payment.refund_attention_required", entityType: "Refund", entityId: localRefundId },
      }),
    ).toBe(1);

    provider.stopFailingRefunds();
  });

  it("does not let a stale payment_intent.payment_failed webhook downgrade an order whose payment already succeeded but hasn't reached PAID yet", async () => {
    const holderKey = "ticket-stale-webhook-mid-finalize-0016";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, TicketOrderStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");

    // Directly reproduces the narrow window a real finalizeOrder call can
    // leave an order in: its own Payment -> SUCCEEDED transaction has
    // committed, but the SEPARATE ticket-issuing transaction that advances
    // TicketOrder to PAID hasn't committed yet (Payment.status is
    // deliberately decoupled from ticket issuance -- see finalizeOrder). A
    // stale webhook landing in exactly this window must not be able to
    // observe it as "payment not yet succeeded."
    await prisma.payment.update({
      where: { ticketOrderId: checkout.orderId },
      data: { status: PaymentStatus.SUCCEEDED },
    });

    const beforeWebhook = await prisma.ticketOrder.findUniqueOrThrow({
      where: { id: checkout.orderId },
    });
    expect(beforeWebhook.status).toBe(TicketOrderStatus.AWAITING_PAYMENT);

    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_stale_failure_during_finalize_window_0016",
        type: "payment_intent.payment_failed",
        paymentIntentId: checkout.payment.providerPaymentId,
      }),
    );
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(raw))
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);

    const afterWebhook = await prisma.ticketOrder.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { payment: true },
    });
    expect(afterWebhook.status).toBe(TicketOrderStatus.AWAITING_PAYMENT);
    expect(afterWebhook.payment?.status).toBe(PaymentStatus.SUCCEEDED);

    // The order can still legitimately finalize afterward -- the stale
    // webhook must not have left it stuck in some unrecoverable state.
    const finalize = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(finalize.status).toBe(201);
    expect(finalize.body.status).toBe("PAID");
  });

  it("keeps Payment and Refund consistent when the async webhook path and a concurrent reconciliation sweep race on the same refund", async () => {
    const holderKey = "ticket-refund-webhook-vs-reconcile-race-0017";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, RefundStatus } = await import("@cinema/database");
    const { TicketingService } = await import("../src/ticketing/ticketing.service");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const ticketingService = app.get(TicketingService);

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    provider.makeRefundsReturnStatus("PENDING");
    await prisma.seatHold.update({
      where: { holdToken: hold.holdToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(result.status).toBe(409);

    const pending = await prisma.payment.findFirstOrThrow({
      where: { ticketOrderId: checkout.orderId },
      include: { refunds: true },
    });
    const localRefundId = pending.refunds[0].id;
    const providerRefundId = pending.refunds[0].providerRefundId as string;

    // Two contradicting terminal outcomes, each observed independently:
    // the reconciliation sweep will retrieveRefund and see FAILED live;
    // the webhook reports SUCCEEDED. Whichever wins the race, the loser
    // must not corrupt consistency between Payment and Refund -- this is
    // exactly the invariant the count-guarded Payment write in
    // applyAsyncRefundUpdate exists to protect (before that fix, a
    // lost-race webhook could still flip Payment to REFUNDED even when
    // the Refund row correctly stayed at whatever the winner recorded).
    provider.setRefundLiveStatus(providerRefundId, "FAILED");
    const webhookRaw = Buffer.from(
      JSON.stringify({
        id: "evt_test_refund_webhook_vs_reconcile_race_0017",
        type: "refund.updated",
        refund: { providerRefundId, status: "SUCCEEDED", metadata: { refundId: localRefundId } },
      }),
    );

    await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/ticketing/webhooks/stripe")
        .set("Stripe-Signature", provider.signWebhook(webhookRaw))
        .set("Content-Type", "application/json")
        .send(webhookRaw.toString()),
      ticketingService.reconcilePendingRefunds(),
    ]);

    const finalRefund = await prisma.refund.findUniqueOrThrow({ where: { id: localRefundId } });
    const finalPayment = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } });

    expect([RefundStatus.SUCCEEDED, RefundStatus.FAILED]).toContain(finalRefund.status);
    if (finalRefund.status === RefundStatus.SUCCEEDED) {
      expect(finalPayment.status).toBe(PaymentStatus.REFUNDED);
    } else {
      expect(finalPayment.status).toBe(PaymentStatus.SUCCEEDED);
    }

    const alertCount = await prisma.auditEvent.count({
      where: { action: "payment.refund_attention_required", entityType: "Refund", entityId: localRefundId },
    });
    expect(alertCount).toBe(finalRefund.status === RefundStatus.FAILED ? 1 : 0);

    provider.makeRefundsReturnStatus("SUCCEEDED");
  });

  it("ignores an unrecognized webhook event type instead of dispatching a status change onto an unrelated payment", async () => {
    const holderKey = "ticket-unrecognized-webhook-event-0018";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, TicketOrderStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    const finalize = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(finalize.status).toBe(201);
    expect(finalize.body.status).toBe("PAID");

    // Some other Stripe event type this webhook endpoint was never
    // written to act on, carrying no paymentIntentId at all -- must be a
    // safe no-op, never resolved against an arbitrary/unrelated Payment
    // row via Prisma silently dropping an `undefined` filter value.
    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_unrecognized_event_type_0018",
        type: "charge.dispute.created",
      }),
    );
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(raw))
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.duplicate).toBe(false);

    const order = await prisma.ticketOrder.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { payment: true },
    });
    expect(order.status).toBe(TicketOrderStatus.PAID);
    expect(order.payment?.status).toBe(PaymentStatus.SUCCEEDED);
  });

  it("ignores a payment_intent-type webhook event that carries no paymentIntentId, instead of matching an arbitrary payment", async () => {
    const holderKey = "ticket-payment-intent-missing-id-0019";
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { prisma, PaymentStatus, TicketOrderStatus } = await import("@cinema/database");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;

    provider.setIntentStatus(checkout.payment.providerPaymentId, "SUCCEEDED");
    const finalize = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({});
    expect(finalize.status).toBe(201);
    expect(finalize.body.status).toBe("PAID");

    const raw = Buffer.from(
      JSON.stringify({
        id: "evt_test_payment_intent_missing_id_0019",
        type: "payment_intent.payment_failed",
      }),
    );
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/ticketing/webhooks/stripe")
      .set("Stripe-Signature", provider.signWebhook(raw))
      .set("Content-Type", "application/json")
      .send(raw.toString());
    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.duplicate).toBe(false);

    const order = await prisma.ticketOrder.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { payment: true },
    });
    expect(order.status).toBe(TicketOrderStatus.PAID);
    expect(order.payment?.status).toBe(PaymentStatus.SUCCEEDED);
  });
});

describe("Customer authentication", () => {
  const email = "new-customer@m0test.local";
  let accessCookie: string;
  let refreshCookie: string;

  it("registers a new customer account and stores tokens only in HttpOnly cookies", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-1", name: "New Customer" });

    expect(res.status).toBe(201);
    expect(res.body.customer.isGuest).toBe(false);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = setCookieHeaders(res);
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^attend_customer_access=.*HttpOnly.*SameSite=Lax/),
      expect.stringMatching(/^attend_customer_refresh=.*HttpOnly.*SameSite=Lax/),
    ]));
  });

  it("rejects registering the same email twice (409 conflict)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .send({ email, password: "customer-password-1", name: "New Customer" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("upgrades a ticket-checkout guest without losing their customer identity", async () => {
    const guestEmail = "ticket-guest-upgrade@m0test.local";
    const { prisma } = await import("@cinema/database");
    const guest = await prisma.customer.create({
      data: { email: guestEmail, name: "Ticket Guest", isGuest: true },
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({
        email: guestEmail.toUpperCase(),
        password: "customer-password-2",
        name: "Registered Customer",
      });

    expect(res.status).toBe(201);
    expect(res.body.customer.id).toBe(guest.id);
    expect(res.body.customer.isGuest).toBe(false);
  });

  it("logs the customer in without exposing either token to JavaScript", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email: "NEW-CUSTOMER@M0TEST.LOCAL", password: "customer-password-1" });

    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe(email);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = setCookieHeaders(res);
    accessCookie = cookiePair(cookies, "attend_customer_access");
    refreshCookie = cookiePair(cookies, "attend_customer_refresh");
  });

  it("restores the signed-in customer's account from the access cookie", async () => {
    const account = await request(app.getHttpServer())
      .get("/api/v1/auth/customers/me")
      .set("Cookie", accessCookie);

    expect(account.status).toBe(200);
    expect(account.body.customer).toMatchObject({ email, isGuest: false });
    expect(account.body.orders).toEqual(expect.any(Array));
  });

  it("refreshes from the HttpOnly refresh cookie and restores an access-cookie session", async () => {
    const refreshed = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/refresh")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", refreshCookie)
      .send();
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeUndefined();
    expect(refreshed.body.refreshToken).toBeUndefined();
    const cookies = setCookieHeaders(refreshed);
    accessCookie = cookiePair(cookies, "attend_customer_access");
    refreshCookie = cookiePair(cookies, "attend_customer_refresh");

    await request(app.getHttpServer())
      .get("/api/v1/auth/customers/me")
      .set("Cookie", accessCookie)
      .expect(200);
  });

  it("rejects a foreign Origin before a cookie-authenticated state change", async () => {
    const protectedMutation = await request(app.getHttpServer())
      .post("/api/v1/customer/restaurant-tabs/00000000-0000-4000-8000-000000000001/tip")
      .set("Origin", "https://attacker.example")
      .set("Cookie", accessCookie)
      .send({ tipCents: 100 });
    expect(protectedMutation.status).toBe(403);
    expect(protectedMutation.body.code).toBe("FORBIDDEN");

    const rejected = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/logout")
      .set("Origin", "https://attacker.example")
      .set("Cookie", `${accessCookie}; ${refreshCookie}`)
      .send();
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe("FORBIDDEN");

    await request(app.getHttpServer())
      .get("/api/v1/auth/customers/me")
      .set("Cookie", accessCookie)
      .expect(200);
  });

  it("logs out with the refresh cookie and expires both browser cookies", async () => {
    const logout = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/logout")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", `${accessCookie}; ${refreshCookie}`)
      .send();
    expect(logout.status).toBe(204);
    const cookies = setCookieHeaders(logout);
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^attend_customer_access=;.*Expires=/),
      expect.stringMatching(/^attend_customer_refresh=;.*Expires=/),
    ]));

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/refresh")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", refreshCookie)
      .send()
      .expect(401);
  });

  it("rejects login CSRF from an untrusted browser origin", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", "https://attacker.example")
      .send({ email, password: "customer-password-1" });
    expect(res.status).toBe(403);
    expect(setCookieHeaders(res)).toHaveLength(0);
  });

  it("does not expose customer account data without a customer session", async () => {
    const account = await request(app.getHttpServer())
      .get("/api/v1/auth/customers/me");

    expect(account.status).toBe(401);
  });

  it("rejects an invalid password", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .send({ email, password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});

describe("Input validation", () => {
  it("rejects a malformed login body before it reaches business logic", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: "not-an-email", password: "" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });
});

describe("Milestone 4 ticket admission", () => {
  const showtimeId = "31000000-0000-0000-0002-000000000002";

  it("rejects the wrong showtime, admits once, and records a repeated scan", async () => {
    const wrong = await request(app.getHttpServer())
      .post("/api/v1/ticketing/scans")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        credential: milestone4Credential,
        expectedShowtimeId: "31000000-0000-0000-0001-000000000001",
      });
    expect(wrong.status).toBe(201);
    expect(wrong.body.result).toBe("WRONG_SHOWTIME");

    const simultaneous = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post("/api/v1/ticketing/scans")
          .set("Authorization", `Bearer ${ownerAccessToken}`)
          .send({ credential: milestone4Credential, expectedShowtimeId: showtimeId }),
      ),
    );
    expect(simultaneous.map((response) => response.body.result).sort())
      .toEqual(["ALREADY_USED", "VALID"]);

    const { prisma } = await import("@cinema/database");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: milestone4TicketId } })).status)
      .toBe("ADMITTED");
    expect(await prisma.ticketScan.count({ where: { ticketId: milestone4TicketId } })).toBe(3);
  });

  it("reports a refunded ticket without admitting it", async () => {
    const { prisma } = await import("@cinema/database");
    await prisma.ticket.update({ where: { id: milestone4TicketId }, data: { status: "REFUNDED" } });
    const result = await request(app.getHttpServer())
      .post("/api/v1/ticketing/scans")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ credential: milestone4Credential, expectedShowtimeId: showtimeId });
    expect(result.body.result).toBe("REFUNDED");
  });

  it("rejects a tampered credential and a staff role without ticket.scan", async () => {
    const invalid = await request(app.getHttpServer())
      .post("/api/v1/ticketing/scans")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ credential: `${milestone4Credential}tampered`, expectedShowtimeId: showtimeId });
    expect(invalid.body.result).toBe("INVALID");

    const server = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    const forbidden = await request(app.getHttpServer())
      .post("/api/v1/ticketing/scans")
      .set("Authorization", `Bearer ${server.body.accessToken}`)
      .send({ credential: milestone4Credential, expectedShowtimeId: showtimeId });
    expect(forbidden.status).toBe(403);
  });
});

describe("Milestone 5 seat-linked dining tabs", () => {
  const showtimeId = "31000000-0000-0000-0002-000000000002";
  let sharedTabId: string;

  async function purchaseSeats(holderKey: string, seatCount: number, authorizeDining: boolean) {
    const availability = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    const seats = availability.body.seats
      .filter((seat: { state: string }) => seat.state === "AVAILABLE")
      .slice(0, seatCount);
    expect(seats).toHaveLength(seatCount);
    const hold = await request(app.getHttpServer())
      .post(`/api/v1/cinema/showtimes/${showtimeId}/holds`)
      .send({
        seatIds: seats.map((seat: { id: string }) => seat.id),
        holderKey,
      });
    expect(hold.status).toBe(201);
    const config = await request(app.getHttpServer())
      .get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`);
    const checkout = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: hold.body.map((entry: { holdToken: string }) => entry.holdToken),
        holderKey,
        ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`,
        diningAuthorizationRequested: authorizeDining,
      });
    expect(checkout.status).toBe(201);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    provider.setIntentStatus(checkout.body.payment.providerPaymentId, "SUCCEEDED");
    const confirmation = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`)
      .send({});
    expect(confirmation.status).toBe(201);
    expect(confirmation.body.diningAuthorization)
      .toBe(authorizeDining ? "AUTHORIZED" : "DECLINED");
    return checkout.body.orderId as string;
  }

  it("opens one idempotent shared tab for a multi-seat authorized order", async () => {
    const orderId = await purchaseSeats("m5-shared-holder-0001", 2, true);
    const simultaneous = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post("/api/v1/restaurant-tabs/seat-linked")
          .set("Authorization", `Bearer ${ownerAccessToken}`)
          .send({ ticketOrderId: orderId, mode: "SHARED" }),
      ),
    );
    expect(simultaneous.every((response) => response.status === 201)).toBe(true);
    expect(simultaneous[0].body).toHaveLength(1);
    expect(simultaneous[1].body[0].id).toBe(simultaneous[0].body[0].id);
    expect(simultaneous[0].body[0].seats).toHaveLength(2);
    expect(simultaneous[0].body[0].status).toBe("PREAUTHORIZED");
    expect(simultaneous[0].body[0].paymentMethod).toEqual({
      brand: "visa",
      last4: "4242",
    });
    sharedTabId = simultaneous[0].body[0].id;
    milestone8TabId = sharedTabId;

    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.auditEvent.count({
        where: {
          action: "restaurant_tab.opened",
          entityId: sharedTabId,
        },
      }),
    ).toBe(1);
  });

  it("opens one tab per seat when separate tabs are requested", async () => {
    const orderId = await purchaseSeats("m5-separate-holder-0002", 2, false);
    const result = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/seat-linked")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketOrderId: orderId, mode: "SEPARATE" });
    expect(result.status).toBe(201);
    expect(result.body).toHaveLength(2);
    expect(result.body.every((tab: { seats: unknown[] }) => tab.seats.length === 1)).toBe(true);
    expect(result.body.every((tab: { status: string }) => tab.status === "OPEN")).toBe(true);
  });

  it("treats shared and separate retries as equivalent for a single-seat order", async () => {
    const orderId = await purchaseSeats("m5-single-holder-0003", 1, false);
    const separate = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/seat-linked")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketOrderId: orderId, mode: "SEPARATE" });
    const sharedRetry = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/seat-linked")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketOrderId: orderId, mode: "SHARED" });

    expect(separate.status).toBe(201);
    expect(sharedRetry.status).toBe(201);
    expect(sharedRetry.body[0].id).toBe(separate.body[0].id);
  });

  it("enforces restaurant permission server-side", async () => {
    const { prisma } = await import("@cinema/database");
    const location = await prisma.location.findFirstOrThrow();
    const { signTokenPair, Permission } = await import("@cinema/auth");
    const doorAccessToken = signTokenPair(
      {
        sub: "00000000-0000-0000-0000-000000000098",
        actorType: "EMPLOYEE",
        locationId: location.id,
        permissions: [Permission.TicketScan],
      },
      {
        sub: "00000000-0000-0000-0000-000000000098",
        actorType: "EMPLOYEE",
        tokenVersion: 0,
      },
      {
        accessSecret: process.env.JWT_ACCESS_SECRET!,
        refreshSecret: process.env.JWT_REFRESH_SECRET!,
        accessTtlSeconds: 900,
        refreshTtlSeconds: 3600,
      },
    ).accessToken;
    const result = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/seat-linked")
      .set("Authorization", `Bearer ${doorAccessToken}`)
      .send({
        ticketOrderId: "00000000-0000-0000-0000-000000000001",
        mode: "SHARED",
      });
    expect(result.status).toBe(403);
  });

  it("splits a seat from a shared tab and combines it back without rewriting seat history", async () => {
    const summary = await request(app.getHttpServer())
      .get(`/api/v1/restaurant-tabs/${sharedTabId}/summary`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    const showtimeSeatId = summary.body.seats[0].showtimeSeatId as string;
    const split = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${sharedTabId}/split`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ showtimeSeatId });
    expect(split.status).toBe(201);

    const separated = await request(app.getHttpServer())
      .get(`/api/v1/restaurant-tabs/${split.body.targetTabId}/summary`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(separated.body.seats).toHaveLength(1);
    expect(separated.body.seats[0].showtimeSeatId).toBe(showtimeSeatId);
    expect(separated.body).toMatchObject({
      status: "OPEN",
      autoSettleAuthorized: false,
      paymentMethod: null,
    });

    const combined = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${sharedTabId}/combine`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ sourceTabId: split.body.targetTabId });
    expect(combined.status).toBe(201);
    const restored = await request(app.getHttpServer())
      .get(`/api/v1/restaurant-tabs/${sharedTabId}/summary`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(restored.body.seats).toHaveLength(2);
  });

  it("does not expose a tab summary to staff scoped to another location", async () => {
    const { prisma } = await import("@cinema/database");
    const organization = await prisma.organization.findFirstOrThrow();
    const otherLocation = await prisma.location.create({
      data: {
        organizationId: organization.id,
        name: "Other Cinema",
      },
    });
    const { signTokenPair, Permission } = await import("@cinema/auth");
    const otherLocationToken = signTokenPair(
      {
        sub: "00000000-0000-0000-0000-000000000099",
        actorType: "EMPLOYEE",
        locationId: otherLocation.id,
        permissions: [Permission.RestaurantOrderCreate],
      },
      {
        sub: "00000000-0000-0000-0000-000000000099",
        actorType: "EMPLOYEE",
        tokenVersion: 0,
      },
      {
        accessSecret: process.env.JWT_ACCESS_SECRET!,
        refreshSecret: process.env.JWT_REFRESH_SECRET!,
        accessTtlSeconds: 900,
        refreshTtlSeconds: 3600,
      },
    ).accessToken;

    const result = await request(app.getHttpServer())
      .get(`/api/v1/restaurant-tabs/${sharedTabId}/summary`)
      .set("Authorization", `Bearer ${otherLocationToken}`);
    expect(result.status).toBe(404);
  });
});

describe("Milestone 6 server POS and menus", () => {
  it("publishes only active, available menu items with dietary tags and movie specials", async () => {
    const { prisma } = await import("@cinema/database");
    const burger = await prisma.menuItem.findFirstOrThrow({ where: { name: "Cheeseburger" } });
    const movie = await prisma.movie.findFirstOrThrow({ where: { title: "Integration Feature" } });

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurant-menu/items/${burger.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ isGlutenFree: true })
      .expect(200);
    await prisma.moviePairing.upsert({
      where: { movieId_menuItemId: { movieId: movie.id, menuItemId: burger.id } },
      update: {},
      create: { movieId: movie.id, menuItemId: burger.id },
    });

    const published = await request(app.getHttpServer()).get("/api/v1/cinema/menu").expect(200);
    const items = published.body.categories.flatMap((category: { items: unknown[] }) => category.items) as Array<{ id: string; isGlutenFree: boolean }>;
    expect(items).toContainEqual(expect.objectContaining({ id: burger.id, isGlutenFree: true }));
    expect(published.body.movieSpecials).toContainEqual(expect.objectContaining({
      movieId: movie.id,
      items: expect.arrayContaining([expect.objectContaining({ id: burger.id })]),
    }));

    await prisma.menuItem.update({ where: { id: burger.id }, data: { is86d: true } });
    const unavailable = await request(app.getHttpServer()).get("/api/v1/cinema/menu").expect(200);
    expect(unavailable.body.categories.flatMap((category: { items: Array<{ id: string }> }) => category.items).some((item: { id: string }) => item.id === burger.id)).toBe(false);
    expect(unavailable.body.movieSpecials.some((special: { movieId: string }) => special.movieId === movie.id)).toBe(false);
    await prisma.menuItem.update({ where: { id: burger.id }, data: { is86d: false } });
  });

  it("opens a walk-in tab and sends items to the correct kitchen and bar stations", async () => {
    const menu = await request(app.getHttpServer())
      .get("/api/v1/restaurant-menu")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(menu.status).toBe(200);
    const items = menu.body.categories.flatMap(
      (category: { items: unknown[] }) => category.items,
    ) as Array<{
      id: string;
      name: string;
      kitchenStation: { name: string };
      modifierGroups: Array<{
        required: boolean;
        modifiers: Array<{ id: string }>;
      }>;
    }>;
    const burger = items.find((item) => item.name === "Cheeseburger")!;
    const cocktail = items.find((item) => item.name === "Old Fashioned")!;

    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Bar guest 12" });
    expect(tab.status).toBe(201);
    expect(tab.body).toMatchObject({
      tabType: "WALK_IN",
      label: "Bar guest 12",
      showtimeId: null,
      autoSettleAuthorized: false,
    });

    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    expect(order.status).toBe(201);
    for (const item of [burger, cocktail]) {
      const modifierIds = item.modifierGroups
        .filter((group) => group.required)
        .map((group) => group.modifiers[0]!.id);
      const added = await request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ menuItemId: item.id, quantity: 1, modifierIds });
      expect(added.status).toBe(201);
    }
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe("SENT");

    const { prisma } = await import("@cinema/database");
    const routed = await prisma.restaurantOrderItem.findMany({
      where: { restaurantOrderId: order.body.id },
      include: { kitchenStation: true },
    });
    expect(routed.map((item) => item.kitchenStation.name).sort()).toEqual([
      "Bar",
      "Kitchen",
    ]);
  });

  it("authoritatively rejects an item that becomes 86'd after it was added", async () => {
    const { prisma } = await import("@cinema/database");
    const burger = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Cheeseburger" },
      include: { modifierGroups: { include: { modifiers: true } } },
    });
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "86 check" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        menuItemId: burger.id,
        quantity: 1,
        modifierIds: [burger.modifierGroups[0]!.modifiers[0]!.id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/restaurant-menu/items/${burger.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ is86d: true })
      .expect(200);
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    expect(sent.status).toBe(409);
    expect(sent.body.message).toContain("Cheeseburger");
    expect(await prisma.restaurantOrder.findUniqueOrThrow({ where: { id: order.body.id } }))
      .toMatchObject({ status: "DRAFT", placedAt: null });
    await prisma.menuItem.update({ where: { id: burger.id }, data: { is86d: false } });
  });

  it("sends available lines while preserving an 86'd line in a replacement draft", async () => {
    const { prisma } = await import("@cinema/database");
    const [burger, cocktail] = await Promise.all([
      prisma.menuItem.findFirstOrThrow({
        where: { name: "Cheeseburger" },
        include: { modifierGroups: { include: { modifiers: true } } },
      }),
      prisma.menuItem.findFirstOrThrow({ where: { name: "Old Fashioned" } }),
    ]);
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Partial 86 check" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        menuItemId: burger.id,
        quantity: 1,
        modifierIds: [burger.modifierGroups[0]!.modifiers[0]!.id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] })
      .expect(201);
    await prisma.menuItem.update({ where: { id: burger.id }, data: { is86d: true } });

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe("SENT");
    expect(sent.body.items).toHaveLength(1);
    expect(sent.body.items[0].menuItemId).toBe(cocktail.id);
    expect(sent.body.rejectedDraft.items).toEqual([
      expect.objectContaining({
        menuItemId: burger.id,
        name: "Cheeseburger",
        reason: "MENU_ITEM_86D",
      }),
    ]);
    const rejected = await prisma.restaurantOrder.findUniqueOrThrow({
      where: { id: sent.body.rejectedDraft.orderId },
      include: { items: true },
    });
    expect(rejected.status).toBe("DRAFT");
    expect(rejected.items).toEqual([
      expect.objectContaining({ menuItemId: burger.id, status: "DRAFT" }),
    ]);
    await request(app.getHttpServer())
      .delete(
        `/api/v1/restaurant-tabs/orders/${rejected.id}/items/${rejected.items[0]!.id}`,
      )
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(
      await prisma.restaurantOrderItem.count({
        where: { restaurantOrderId: rejected.id },
      }),
    ).toBe(0);
    await prisma.menuItem.update({ where: { id: burger.id }, data: { is86d: false } });
  });

  it("transfers an order between compatible open tabs and records the move", async () => {
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Transfer source" });
    const target = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Transfer target" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${source.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    const moved = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/transfer`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ targetTabId: target.body.id });
    expect(moved.status).toBe(201);
    expect(moved.body.restaurantTabId).toBe(target.body.id);

    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.auditEvent.count({
        where: { action: "restaurant_order.transferred", entityId: order.body.id },
      }),
    ).toBe(1);
  });
});

describe("Milestone 7 kitchen and bar fulfillment", () => {
  async function createMixedFulfillmentOrder(label: string) {
    const menu = await request(app.getHttpServer())
      .get("/api/v1/restaurant-menu")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    const items = menu.body.categories.flatMap(
      (category: { items: unknown[] }) => category.items,
    ) as Array<{
      id: string;
      name: string;
      modifierGroups: Array<{
        required: boolean;
        modifiers: Array<{ id: string }>;
      }>;
    }>;
    const burger = items.find((item) => item.name === "Cheeseburger")!;
    const cocktail = items.find((item) => item.name === "Old Fashioned")!;
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    for (const item of [burger, cocktail]) {
      await request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          menuItemId: item.id,
          quantity: 1,
          modifierIds: item.modifierGroups
            .filter((group) => group.required)
            .map((group) => group.modifiers[0]!.id),
        })
        .expect(201);
    }
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    expect(sent.status).toBe(201);
    return { tabId: tab.body.id as string, orderId: order.body.id as string, sent };
  }

  it("creates one station-isolated ticket for the burger and one for the cocktail", async () => {
    const { orderId, sent } = await createMixedFulfillmentOrder("M7 routing");
    expect(sent.body.fulfillmentTickets).toHaveLength(2);
    const { prisma } = await import("@cinema/database");
    const tickets = await prisma.fulfillmentTicket.findMany({
      where: { restaurantOrderId: orderId },
      include: {
        kitchenStation: true,
        items: { include: { menuItem: true } },
      },
    });
    expect(
      tickets.map((ticket) => ({
        station: ticket.kitchenStation.name,
        items: ticket.items.map((item) => item.menuItem.name),
      })).sort((left, right) => left.station.localeCompare(right.station)),
    ).toEqual([
      { station: "Bar", items: ["Old Fashioned"] },
      { station: "Kitchen", items: ["Cheeseburger"] },
    ]);
  });

  it("enforces the transition sequence, rolls up the order, and preserves a refire cycle", async () => {
    const { orderId, sent } = await createMixedFulfillmentOrder("M7 states");
    const ticketId = sent.body.fulfillmentTickets[0].id as string;
    for (const [action, expectedStatus] of [
      ["ACCEPT", "ACCEPTED"],
      ["START", "PREPARING"],
      ["READY", "READY"],
      ["DELIVER", "DELIVERED"],
    ] as const) {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/fulfillment/tickets/${ticketId}`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ action });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(expectedStatus);
    }
    const { prisma } = await import("@cinema/database");
    expect(await prisma.restaurantOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: "PARTIALLY_DELIVERED" });

    const server = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    const refire = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/fulfillment/${ticketId}/refire`)
      .set("Authorization", `Bearer ${server.body.accessToken}`)
      .send({});
    expect(refire.status).toBe(201);
    expect(refire.body).toMatchObject({
      status: "NEW",
      refiredFromId: ticketId,
      refireCount: 1,
    });
    const original = await prisma.fulfillmentTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    expect(original).toMatchObject({
      status: "REFIRE",
      refireCount: 1,
      deliveredAt: expect.any(Date),
    });
  });

  it("allows only one winner when the same fulfillment transition is requested concurrently", async () => {
    const { sent } = await createMixedFulfillmentOrder("M7 transition race");
    const ticketId = sent.body.fulfillmentTickets[0].id as string;
    const transition = () =>
      request(app.getHttpServer())
        .patch(`/api/v1/fulfillment/tickets/${ticketId}`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ action: "ACCEPT" });

    const responses = await Promise.all([transition(), transition()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.fulfillmentTicket.findUniqueOrThrow({ where: { id: ticketId } }),
    ).toMatchObject({ status: "ACCEPTED" });
  });

  it("cancels active tickets, voids ready tickets, and rolls a fully stopped order to canceled", async () => {
    const { orderId, sent } = await createMixedFulfillmentOrder("M7 cancel and void");
    const [cancelTicket, voidTicket] = sent.body.fulfillmentTickets as Array<{
      id: string;
    }>;

    await request(app.getHttpServer())
      .patch(`/api/v1/fulfillment/tickets/${cancelTicket.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ action: "CANCEL" })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("CANCELED"));

    for (const action of ["ACCEPT", "START", "READY"] as const) {
      await request(app.getHttpServer())
        .patch(`/api/v1/fulfillment/tickets/${voidTicket.id}`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ action })
        .expect(200);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/fulfillment/tickets/${voidTicket.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ action: "CANCEL" })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/fulfillment/tickets/${voidTicket.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ action: "VOID" })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("VOIDED"));

    const { prisma } = await import("@cinema/database");
    expect(await prisma.restaurantOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: "CANCELED" });
  });

  it("requires kitchen status permission and scopes station queues to the staff location", async () => {
    const server = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    await request(app.getHttpServer())
      .get("/api/v1/fulfillment/stations")
      .set("Authorization", `Bearer ${server.body.accessToken}`)
      .expect(403);

    const { prisma } = await import("@cinema/database");
    const organization = await prisma.organization.findFirstOrThrow();
    const otherLocation = await prisma.location.create({
      data: { organizationId: organization.id, name: "M7 Other Cinema" },
    });
    const otherStation = await prisma.kitchenStation.create({
      data: {
        locationId: otherLocation.id,
        name: "Other Kitchen",
        displayType: "KITCHEN",
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/fulfillment/stations/${otherStation.id}/queue`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(404);
  });
});

describe("Milestone 8 restaurant settlement and tipping", () => {
  it("drops the check, permits one final order, and closes with split tender", async () => {
    const { prisma } = await import("@cinema/database");
    const settlementTab = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: { locationId: true },
    });
    await prisma.taxRule.create({
      data: {
        locationId: settlementTab.locationId,
        name: "M8 test tax",
        appliesTo: "ALL",
        ratePermille: 100,
      },
    });
    await prisma.serviceChargeRule.create({
      data: {
        locationId: settlementTab.locationId,
        name: "M8 test service",
        appliesTo: "ALL",
        flatCents: 100,
      },
    });
    const summary = await request(app.getHttpServer())
      .get(`/api/v1/restaurant-tabs/${milestone8TabId}/summary`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    const showtimeSeatId = summary.body.seats[0].showtimeSeatId as string;
    const [burger, cocktail] = await Promise.all([
      prisma.menuItem.findFirstOrThrow({
        where: { name: "Cheeseburger" },
        include: { modifierGroups: { include: { modifiers: true } } },
      }),
      prisma.menuItem.findFirstOrThrow({ where: { name: "Old Fashioned" } }),
    ]);
    const addAndSend = async (
      item: typeof burger | typeof cocktail,
      modifierIds: string[],
    ) => {
      const order = await request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${milestone8TabId}/orders`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ showtimeSeatId });
      expect(order.status).toBe(201);
      await request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ menuItemId: item.id, quantity: 1, modifierIds })
        .expect(201);
      return request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({})
        .expect(201);
    };
    const burgerSent = await addAndSend(
      burger,
      [burger.modifierGroups[0]!.modifiers[0]!.id],
    );
    const cocktailSent = await addAndSend(cocktail, []);
    for (const ticket of [
      ...burgerSent.body.fulfillmentTickets,
      ...cocktailSent.body.fulfillmentTickets,
    ] as Array<{ id: string }>) {
      for (const action of ["ACCEPT", "START", "READY", "DELIVER"]) {
        await request(app.getHttpServer())
          .patch(`/api/v1/fulfillment/tickets/${ticket.id}`)
          .set("Authorization", `Bearer ${ownerAccessToken}`)
          .send({ action })
          .expect(200);
      }
    }
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${milestone8TabId}/drop-check`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);

    const guestLink = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${milestone8TabId}/access-link`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/public/restaurant-tabs/${guestLink.body.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/public/restaurant-tabs/${guestLink.body.token}tampered`)
      .expect(401);

    // Check drop deliberately does not prevent a final order.
    await addAndSend(cocktail, []);
    const tab = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${milestone8TabId}/finalize`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        requestId: "88000000-0000-0000-0000-000000000000",
        tipCents: 880,
        tenders: [
          {
            type: "SAVED_METHOD",
            amountCents: 3000,
            paymentMethodReferenceId: tab.activePaymentMethodId,
          },
          {
            type: "CARD_PRESENT",
            amountCents: 2819,
            readerId: "tmr_test_mismatch",
          },
        ],
      })
      .expect(400);
    expect(
      await prisma.payment.count({
        where: { restaurantTabId: milestone8TabId },
      }),
    ).toBe(0);

    const finalized = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${milestone8TabId}/finalize`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        requestId: "88000000-0000-0000-0000-000000000001",
        tipCents: 880,
        tenders: [
          {
            type: "SAVED_METHOD",
            amountCents: 3000,
            paymentMethodReferenceId: tab.activePaymentMethodId,
          },
          {
            type: "CARD_PRESENT",
            amountCents: 2820,
            readerId: "tmr_test_split",
          },
        ],
      });
    expect(finalized.status).toBe(201);
    expect(finalized.body.status).toBe("CLOSED");
    expect(
      await prisma.payment.count({
        where: { restaurantTabId: milestone8TabId, status: "SUCCEEDED" },
      }),
    ).toBe(2);
    expect(
      await prisma.restaurantReceipt.findUnique({
        where: { restaurantTabId: milestone8TabId },
      }),
    ).toMatchObject({
      subtotalCents: 4400,
      taxCents: 440,
      serviceChargeCents: 100,
      tipCents: 880,
      totalCents: 5820,
    });
  });

  it("runs fallback once, does not retry a failed card, and surfaces attention", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: {
        activePaymentMethod: { include: { paymentCustomer: true } },
        showtime: true,
        orders: { include: { items: true } },
      },
    });
    const declinedMethod = await prisma.paymentMethodReference.create({
      data: {
        paymentCustomerId: source.activePaymentMethod!.paymentCustomerId,
        provider: "test",
        providerPaymentMethodId: "pm_declined_m8",
        brand: "visa",
        last4: "0002",
        expMonth: 12,
        expYear: 2035,
      },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "SEAT_LINKED",
        showtimeId: source.showtimeId,
        status: "PREAUTHORIZED",
        autoSettleAuthorized: true,
        activePaymentMethodId: declinedMethod.id,
      },
    });
    await prisma.restaurantTab.updateMany({
      where: {
        showtimeId: source.showtimeId,
        id: { not: tab.id },
        status: { in: ["PREAUTHORIZED", "OPEN"] },
      },
      data: { autoSettleAuthorized: false },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    await prisma.restaurantOrder.create({
      data: {
        restaurantTabId: tab.id,
        serverEmployeeId: server.id,
        status: "SENT",
        placedAt: new Date(),
        items: {
          create: {
            menuItemId: cocktail.id,
            quantity: 1,
            unitPriceCentsSnapshot: cocktail.priceCents,
            selectedModifiers: [],
            kitchenStationId: cocktail.kitchenStationId,
            status: "SENT",
          },
        },
      },
    });
    await prisma.showtime.update({
      where: { id: source.showtimeId! },
      data: { endsAt: new Date(Date.now() - 10 * 60_000) },
    });

    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const settlement = app.get(RestaurantSettlementService);
    await settlement.runFallback();
    await settlement.runFallback();
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).toMatchObject({ status: "PAYMENT_FAILED" });
    const attention = await request(app.getHttpServer())
      .get("/api/v1/restaurant-settlement/attention")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(attention.body.map((candidate: { id: string }) => candidate.id))
      .toContain(tab.id);
  });
});

describe("Milestone 9 box office and workforce", () => {
  it("clocks staff in by PIN, rejects duplicate punches, records breaks, and clocks out", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const body = { locationId: owner.locationId, employeeId: owner.id, pin: "1234" };
    const clockIn = await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(201);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(409);
    await request(app.getHttpServer()).post("/api/v1/shifts/break/start").send(body).expect(201);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send(body).expect(409);
    await request(app.getHttpServer()).post("/api/v1/shifts/break/end").send(body).expect(201);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send(body).expect(201);
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: clockIn.body.id } });
    expect(shift.clockOutAt).not.toBeNull();
    expect(shift.breakStartAt).not.toBeNull();
    expect(shift.breakEndAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "Shift", entityId: shift.id } })).toBe(4);
    const correctedClockOut = new Date(shift.clockOutAt!.getTime() + 60_000).toISOString();
    await request(app.getHttpServer()).patch(`/api/v1/shifts/${shift.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ clockOutAt: correctedClockOut, notes: "Manager correction for E2E verification" }).expect(200);
    expect(await prisma.auditEvent.count({ where: { entityType: "Shift", entityId: shift.id, action: "shift.manager_adjusted" } })).toBe(1);
  });

  it("enforces promotion minimum subtotals and redemption limits", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } }, }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      include: { showtime: { include: { priceTier: true } } },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const promotion = await prisma.promotion.create({ data: { locationId: owner.locationId, code: `LIMIT${Date.now()}`, name: "Usage controls", type: "FIXED_AMOUNT", amountCents: 100, minimumSubtotalCents: inventory.showtime.priceTier.ticketPriceMinor + 1, maximumRedemptions: 1 } });
    const holderKey = `promotion-controls-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);
    const quoteBody = { holdTokens: [holds.body[0].holdToken], holderKey, promotionCode: promotion.code };

    await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(quoteBody).expect(400);

    await prisma.promotion.update({ where: { id: promotion.id }, data: { minimumSubtotalCents: 0 } });
    await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), status: "PAID", orderNumber: `LIMIT-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 0, feesCents: 0, taxCents: 0, totalCents: 0, promotionId: promotion.id } });
    await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(quoteBody).expect(409);
  });

  it("uses shared seat inventory for a mixed-tender box-office sale and full refund", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      include: { showtime: true },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ registerId: "E2E-BOX", openingBalanceCents: 20000 }).expect(201);
    const holderKey = `box-office-e2e-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);

    // The public channel sees the same hold and cannot acquire a second one.
    await request(app.getHttpServer()).post(`/api/v1/cinema/showtimes/${inventory.showtimeId}/holds`)
      .send({ seatIds: [inventory.seatId], holderKey: `online-e2e-${crypto.randomUUID()}` }).expect(409);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey }).expect(201);
    const cashCents = Math.floor(quote.body.totalCents / 2);
    const cardCents = quote.body.totalCents - cashCents;
    const sale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({
        requestId: crypto.randomUUID(), holdTokens: [holds.body[0].holdToken], holderKey,
        ticketTypeId: ticketType.id, cashDrawerId: drawer.body.id, cashCents, cardCents,
        cashReceivedCents: cashCents + 500, readerId: "tmr_e2e_box",
      }).expect(201);
    expect(sale.body.status).toBe("PAID");
    expect(sale.body.tickets).toHaveLength(1);
    expect(sale.body.cashTransactions[0]).toMatchObject({ amountCents: cashCents, changeGivenCents: 500 });
    expect(sale.body.payment).toMatchObject({ amountCents: cardCents, status: "SUCCEEDED" });

    await request(app.getHttpServer()).post(`/api/v1/box-office/tickets/${sale.body.tickets[0].id}/reprint`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({}).expect(201);
    const refunded = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), reason: "E2E full refund", cashDrawerId: drawer.body.id }).expect(201);
    expect(refunded.body.status).toBe("REFUNDED");
    expect(refunded.body.tickets[0].status).toBe("REFUNDED");
    expect(await prisma.cashTransaction.count({ where: { ticketOrderId: sale.body.id } })).toBe(2);
    const history = await request(app.getHttpServer()).get(`/api/v1/management/refunds/history?query=${encodeURIComponent(sale.body.orderNumber)}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(history.body.ticketOrders.map((order: { id: string }) => order.id)).toContain(sale.body.id);
    expect(history.body.ticketOrders.find((order: { id: string }) => order.id === sale.body.id).cashTransactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "REFUND" })]),
    );
  });

  it("refunds a successful card-present charge exactly once when seat finalization loses its hold", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      include: { showtime: true },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const holderKey = `box-office-compensation-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey }).expect(201);
    const requestId = crypto.randomUUID();
    const checkout = request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({
        requestId, holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id,
        cashCents: 0, cardCents: quote.body.totalCents, readerId: "tmr_delayed_finalize_failure",
      }).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await prisma.seatHold.update({ where: { id: holds.body[0].id }, data: { releasedAt: new Date() } });
    expect((await checkout).status).toBe(409);

    const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { checkoutIdempotencyKey: requestId }, include: { payment: { include: { refunds: true } } } });
    expect(order.status).toBe("REFUNDED");
    expect(order.payment?.status).toBe("REFUNDED");
    expect(order.payment?.refunds).toHaveLength(1);
    expect(order.payment?.refunds[0]).toMatchObject({ status: "SUCCEEDED", reason: "BOX_OFFICE_INVENTORY_FINALIZATION_FAILED" });
    expect(await prisma.auditEvent.count({ where: { entityType: "TicketOrder", entityId: order.id, action: "ticket_order.box_office_compensation_succeeded" } })).toBe(1);
  });

  it("rate limits repeated public workforce PIN attempts", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const body = { locationId: owner.locationId, employeeId: crypto.randomUUID(), pin: "0000" };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(403);
    }
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(429);
  });
});

describe("Milestone 10 management reporting", () => {
  it("reports exact ticket and F&B revenue per movie and showtime for a known period", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const movies = await prisma.movie.findMany({ where: { organization: { locations: { some: { id: owner.locationId } } } }, include: { showtimes: { where: { auditorium: { locationId: owner.locationId } }, include: { showtimeSeats: { where: { tickets: { none: {} } }, take: 1 } }, orderBy: { startsAt: "asc" } } } });
    const movie = movies.find((candidate) => candidate.showtimes.length >= 2 && candidate.showtimes[0]!.showtimeSeats.length && candidate.showtimes[1]!.showtimeSeats.length);
    expect(movie).toBeDefined();
    const [firstShowing, secondShowing] = movie!.showtimes;
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const period = { from: new Date("2024-01-01T00:00:00.000Z"), to: new Date("2024-02-01T00:00:00.000Z") };
    const firstOrder = await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "ONLINE", status: "PAID", orderNumber: `M10-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 1700, feesCents: 200, taxCents: 166, totalCents: 2066, createdAt: new Date("2024-01-10T12:00:00.000Z"), tickets: { create: { showtimeSeatId: firstShowing!.showtimeSeats[0]!.id, ticketTypeId: ticketType.id, priceCentsPaid: 1700, qrToken: `m10-${crypto.randomUUID()}` } } } });
    const secondOrder = await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "ONLINE", status: "PAID", orderNumber: `M10-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 1800, feesCents: 100, taxCents: 100, totalCents: 2000, createdAt: new Date("2024-01-12T12:00:00.000Z"), tickets: { create: { showtimeSeatId: secondShowing!.showtimeSeats[0]!.id, ticketTypeId: ticketType.id, priceCentsPaid: 1800, qrToken: `m10-${crypto.randomUUID()}` } } } });
    const [firstTicket, secondTicket] = await Promise.all([prisma.ticket.findFirstOrThrow({ where: { ticketOrderId: firstOrder.id } }), prisma.ticket.findFirstOrThrow({ where: { ticketOrderId: secondOrder.id } })]);
    await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "SEAT_LINKED", showtimeId: firstShowing!.id, status: "CLOSED", subtotalCents: 450, taxCents: 50, serviceChargeCents: 0, totalCents: 500, closedAt: new Date("2024-01-10T16:00:00.000Z"), seats: { create: { showtimeSeatId: firstTicket.showtimeSeatId, ticketId: firstTicket.id } } } });
    await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "SEAT_LINKED", showtimeId: secondShowing!.id, status: "CLOSED", subtotalCents: 650, taxCents: 50, serviceChargeCents: 0, totalCents: 700, closedAt: new Date("2024-01-12T16:00:00.000Z"), seats: { create: { showtimeSeatId: secondTicket.showtimeSeatId, ticketId: secondTicket.id } } } });
    await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "ONLINE", status: "REFUNDED", orderNumber: `M10-R-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 750, feesCents: 25, taxCents: 25, totalCents: 800, createdAt: new Date("2024-01-15T12:00:00.000Z") } });
    await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "WALK_IN", label: "Refunded reporting fixture", status: "REFUNDED", subtotalCents: 275, taxCents: 25, serviceChargeCents: 0, totalCents: 300, closedAt: new Date("2024-01-15T16:00:00.000Z") } });

    const response = await request(app.getHttpServer()).get(`/api/v1/reports/revenue?from=${period.from.toISOString()}&to=${period.to.toISOString()}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(response.body.totals).toMatchObject({ grossRevenueCents: 6366, refundedCents: 1100, ticketRefundedCents: 800, fnbRefundedCents: 300, ticketRevenueCents: 3500, ticketFeesCents: 300, ticketTaxCents: 266, ticketCollectedCents: 4066, fnbRevenueCents: 1200, combinedRevenueCents: 5266, ticketsSold: 2, fnbOrders: 2, averageFnbSpendPerOrderCents: 600, averageFnbSpendPerSeatCents: 600 });
    expect(response.body.movies).toEqual([{ movieId: movie!.id, title: movie!.title, ticketRevenueCents: 3500, ticketsSold: 2, fnbRevenueCents: 1200 }]);
    expect(response.body.showtimes.map((row: { ticketRevenueCents: number; fnbRevenueCents: number; ticketsSold: number }) => ({ ticketRevenueCents: row.ticketRevenueCents, fnbRevenueCents: row.fnbRevenueCents, ticketsSold: row.ticketsSold }))).toEqual([{ ticketRevenueCents: 1700, fnbRevenueCents: 500, ticketsSold: 1 }, { ticketRevenueCents: 1800, fnbRevenueCents: 700, ticketsSold: 1 }]);
    const csv = await request(app.getHttpServer()).get(`/api/v1/reports/revenue.csv?from=${period.from.toISOString()}&to=${period.to.toISOString()}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attend-revenue.csv");
    expect(csv.text).toContain('"Net revenue (cents)","5266"');
    expect(csv.text).toContain('"Ticket face value (cents)","3500"');
    expect(csv.text).toContain('"Ticket fees (cents)","300"');
    expect(csv.text).toContain('"Ticket tax (cents)","266"');
    expect(csv.text).toContain('"Ticket total collected (cents)","4066"');
    expect(csv.text).toContain(`"${movie!.title}","2","3500","1200"`);
  });

  it("reports exact worked minutes and exports payroll-ready CSV", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    await prisma.shift.createMany({ data: [
      { employeeId: owner.id, locationId: owner.locationId, clockInAt: new Date("2024-03-04T09:00:00.000Z"), clockOutAt: new Date("2024-03-04T17:00:00.000Z"), breakStartAt: new Date("2024-03-04T12:00:00.000Z"), breakEndAt: new Date("2024-03-04T12:30:00.000Z") },
      { employeeId: owner.id, locationId: owner.locationId, clockInAt: new Date("2024-03-05T09:00:00.000Z"), clockOutAt: new Date("2024-03-05T13:00:00.000Z") },
    ] });
    const from = "2024-03-01T00:00:00.000Z"; const to = "2024-04-01T00:00:00.000Z";
    const report = await request(app.getHttpServer()).get(`/api/v1/reports/labor?from=${from}&to=${to}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(report.body.totalMinutes).toBe(690);
    expect(report.body.rows.map((row: { workedMinutes: number }) => row.workedMinutes)).toEqual([450, 240]);
    expect(report.body.rows[0]).toEqual(expect.objectContaining({ breakStartAt: "2024-03-04T12:00:00.000Z", breakEndAt: "2024-03-04T12:30:00.000Z" }));
    const csv = await request(app.getHttpServer()).get(`/api/v1/reports/labor.csv?from=${from}&to=${to}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Break minutes,Worked minutes");
    expect(csv.text).toContain('"30","450"');
  });

  it("subtracts only the part of a break that overlaps the labor report window", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    await prisma.shift.create({ data: { employeeId: owner.id, locationId: owner.locationId, clockInAt: new Date("2024-05-01T20:00:00.000Z"), breakStartAt: new Date("2024-05-01T23:00:00.000Z"), breakEndAt: new Date("2024-05-01T23:30:00.000Z"), clockOutAt: new Date("2024-05-02T04:00:00.000Z") } });
    const report = await request(app.getHttpServer()).get("/api/v1/reports/labor?from=2024-05-02T00:00:00.000Z&to=2024-05-03T00:00:00.000Z").set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(report.body.rows).toEqual([expect.objectContaining({ breakMinutes: 0, workedMinutes: 240 })]);
    expect(report.body.totalMinutes).toBe(240);
  });

  it("continues split-tender refunds after ambiguity and can recover manager-review tabs", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { ManagementRefundService } = await import("../src/management/management-refund.service");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const tab = await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "WALK_IN", label: "Split-tender reporting fixture", status: "CLOSED", subtotalCents: 1000, taxCents: 0, serviceChargeCents: 0, totalCents: 1000, closedAt: new Date("2022-06-01T12:00:00.000Z"), payments: { create: [
      { purpose: "RESTAURANT_TAB", amountCents: 400, status: "SUCCEEDED", idempotencyKey: crypto.randomUUID(), provider: "test", providerPaymentId: `pi_ambiguous_${crypto.randomUUID()}` },
      { purpose: "RESTAURANT_TAB", amountCents: 600, status: "SUCCEEDED", idempotencyKey: crypto.randomUUID(), provider: "test", providerPaymentId: `pi_success_${crypto.randomUUID()}` },
    ] } }, include: { payments: true } });
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    const originalRefund = provider.refund.bind(provider);
    const refunds = app.get(ManagementRefundService);
    try {
      provider.refund = async (args) => {
        if (args.providerPaymentId.startsWith("pi_ambiguous_")) throw new Error("Simulated ambiguous timeout");
        return originalRefund(args);
      };
      await expect(refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: crypto.randomUUID(), reason: "Manager test" })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      provider.refund = originalRefund;
    }
    const afterFirstAttempt = await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id }, include: { payments: { include: { refunds: true } } } });
    expect(afterFirstAttempt.status).toBe("MANAGER_REVIEW");
    expect(afterFirstAttempt.payments.map((payment) => payment.status).sort()).toEqual(["REFUNDED", "SUCCEEDED"]);
    const partialReport = await request(app.getHttpServer()).get("/api/v1/reports/revenue?from=2022-01-01T00:00:00.000Z&to=2023-01-01T00:00:00.000Z").set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(partialReport.body.totals).toMatchObject({ grossRevenueCents: 1000, refundedCents: 600, fnbRevenueCents: 400, fnbRefundedCents: 600, combinedRevenueCents: 400, fnbOrders: 1 });
    const recovered = await refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: crypto.randomUUID(), reason: "Manager retry" });
    expect(recovered.status).toBe("REFUNDED");
    expect(recovered.payments.every((payment) => payment.status === "REFUNDED")).toBe(true);
    expect(await prisma.refund.count({ where: { paymentId: { in: tab.payments.map((payment) => payment.id) }, status: "SUCCEEDED" } })).toBe(2);
    const finalReport = await request(app.getHttpServer()).get("/api/v1/reports/revenue?from=2022-01-01T00:00:00.000Z&to=2023-01-01T00:00:00.000Z").set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(finalReport.body.totals).toMatchObject({ grossRevenueCents: 1000, refundedCents: 1000, fnbRevenueCents: 0, fnbRefundedCents: 1000, combinedRevenueCents: 0, fnbOrders: 0 });
  });

  it("enforces the full role and cross-tenant isolation matrix", async () => {
    const { prisma } = await import("@cinema/database");
    const { DEFAULT_ROLE_PERMISSIONS, Permission, RoleKey, signTokenPair } = await import("@cinema/auth");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const tenantB = await prisma.organization.create({ data: { name: `Tenant B ${crypto.randomUUID()}`, locations: { create: { name: "Tenant B Cinema" } } }, include: { locations: true } });
    const locationB = tenantB.locations[0]!;
    const auditoriumB = await prisma.auditorium.create({ data: { locationId: locationB.id, name: "Tenant B Room", capacity: 1, seatMap: { create: { name: "Tenant B Map", seats: { create: { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0 } } } } }, include: { seatMap: { include: { seats: true } } } });
    const [movieB, tierB, typeB, customerB, employeeB] = await Promise.all([
      prisma.movie.create({ data: { organizationId: tenantB.id, title: "Tenant B Secret Film", runtimeMinutes: 90 } }),
      prisma.priceTier.create({ data: { organizationId: tenantB.id, name: "Tenant B Standard", ticketPriceMinor: 999, feeMinor: 0, appliesOnWeekdays: [] } }),
      prisma.ticketType.create({ data: { locationId: locationB.id, name: "Tenant B Adult" } }),
      prisma.customer.create({ data: { name: "Tenant B Patron", email: `patron-${crypto.randomUUID()}@tenant-b.test` } }),
      prisma.employee.create({ data: { locationId: locationB.id, name: "Tenant B Employee", email: `employee-${crypto.randomUUID()}@tenant-b.test` } }),
    ]);
    const showingB = await prisma.showtime.create({ data: { movieId: movieB.id, auditoriumId: auditoriumB.id, priceTierId: tierB.id, startsAt: new Date("2023-06-10T12:00:00.000Z"), featureStartsAt: new Date("2023-06-10T12:30:00.000Z"), endsAt: new Date("2023-06-10T14:00:00.000Z"), roomReadyAt: new Date("2023-06-10T14:15:00.000Z"), onSale: true, showtimeSeats: { create: { seatId: auditoriumB.seatMap!.seats[0]!.id } } }, include: { showtimeSeats: true } });
    const orderB = await prisma.ticketOrder.create({ data: { locationId: locationB.id, customerId: customerB.id, ticketTypeId: typeB.id, holdTokens: [], holderKey: crypto.randomUUID(), status: "PAID", orderNumber: `B-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 999, feesCents: 0, taxCents: 0, totalCents: 999, createdAt: new Date("2023-06-01T12:00:00.000Z"), tickets: { create: { showtimeSeatId: showingB.showtimeSeats[0]!.id, ticketTypeId: typeB.id, priceCentsPaid: 999, qrToken: `tenant-b-${crypto.randomUUID()}` } } } });
    const paymentCustomerB = await prisma.paymentCustomer.create({ data: { organizationId: tenantB.id, customerId: customerB.id, provider: "test", providerCustomerId: `cus_b_${crypto.randomUUID()}` } });
    const paymentMethodB = await prisma.paymentMethodReference.create({ data: { paymentCustomerId: paymentCustomerB.id, provider: "test", providerPaymentMethodId: `pm_b_${crypto.randomUUID()}`, brand: "visa", last4: "4242", expMonth: 12, expYear: 2035 } });
    const tabB = await prisma.restaurantTab.create({ data: { locationId: locationB.id, primaryCustomerId: customerB.id, tabType: "WALK_IN", status: "CLOSED", label: "Tenant B Secret Tab", subtotalCents: 500, taxCents: 0, serviceChargeCents: 0, totalCents: 500, closedAt: new Date("2023-06-01T14:00:00.000Z"), payments: { create: { purpose: "RESTAURANT_TAB", amountCents: 500, status: "SUCCEEDED", idempotencyKey: `tenant-b-${crypto.randomUUID()}`, provider: "test", providerPaymentId: `pi_b_${crypto.randomUUID()}` } } } });
    const restaurantOrderB = await prisma.restaurantOrder.create({ data: { restaurantTabId: tabB.id, serverEmployeeId: employeeB.id, status: "DRAFT" } });
    const auditB = await prisma.auditEvent.create({ data: { actorType: "SYSTEM", locationId: locationB.id, action: `tenant_b.secret.${crypto.randomUUID()}`, entityType: "TenantBSecret", entityId: tenantB.id } });

    const expected = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, permission: string) => DEFAULT_ROLE_PERMISSIONS[role].some((key) => key === permission) ? 404 : 403;
    for (const role of Object.values(RoleKey)) {
      const rolePermissions = DEFAULT_ROLE_PERMISSIONS[role];
      const token = signTokenPair(
        { sub: crypto.randomUUID(), actorType: "EMPLOYEE", locationId: owner.locationId, permissions: rolePermissions },
        { sub: crypto.randomUUID(), actorType: "EMPLOYEE", tokenVersion: 0 },
        { accessSecret: process.env.JWT_ACCESS_SECRET!, refreshSecret: process.env.JWT_REFRESH_SECRET!, accessTtlSeconds: 900, refreshTtlSeconds: 3600 },
      ).accessToken;
      const auth = { Authorization: `Bearer ${token}` };

      await request(app.getHttpServer()).get(`/api/v1/management/customers/${customerB.id}`).set(auth).expect(expected(role, Permission.PaymentViewDisplaySafe));
      await request(app.getHttpServer()).get(`/api/v1/management/payment-methods/${paymentMethodB.id}`).set(auth).expect(expected(role, Permission.PaymentViewDisplaySafe));
      await request(app.getHttpServer()).post(`/api/v1/management/refunds/ticket-orders/${orderB.id}`).set(auth).send({ requestId: crypto.randomUUID(), reason: "Isolation test" }).expect(expected(role, Permission.TicketRefund));
      await request(app.getHttpServer()).post(`/api/v1/management/refunds/restaurant-tabs/${tabB.id}`).set(auth).send({ requestId: crypto.randomUUID(), reason: "Isolation test" }).expect(expected(role, Permission.PaymentRefund));
      await request(app.getHttpServer()).patch(`/api/v1/management/employees/${employeeB.id}`).set(auth).send({ active: false }).expect(expected(role, Permission.EmployeeEdit));
      await request(app.getHttpServer()).patch(`/api/v1/cinema/showtimes/${showingB.id}`).set(auth).send({ onSale: false }).expect(expected(role, Permission.ShowtimeManage));
      await request(app.getHttpServer()).get(`/api/v1/restaurant-tabs/${tabB.id}/summary`).set(auth).expect(expected(role, Permission.RestaurantOrderCreate));
      await request(app.getHttpServer()).post(`/api/v1/restaurant-tabs/orders/${restaurantOrderB.id}/send`).set(auth).expect(expected(role, Permission.RestaurantOrderCreate));

      const auditResponse = await request(app.getHttpServer()).get("/api/v1/audit-events?limit=200").set(auth);
      if (rolePermissions.includes(Permission.AuditLogView)) { expect(auditResponse.status).toBe(200); expect(auditResponse.body.map((event: { id: string }) => event.id)).not.toContain(auditB.id); } else expect(auditResponse.status).toBe(403);
      const reportResponse = await request(app.getHttpServer()).get("/api/v1/reports/revenue?from=2023-06-01T00:00:00.000Z&to=2023-07-01T00:00:00.000Z").set(auth);
      if (rolePermissions.includes(Permission.ReportsViewFinancial)) { expect(reportResponse.status).toBe(200); expect(reportResponse.body.totals.combinedRevenueCents).toBe(0); } else expect(reportResponse.status).toBe(403);
    }
  }, 30_000);
});
