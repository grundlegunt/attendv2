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

let testDb: TestDatabase | undefined;
let app: INestApplication;
let ownerAccessToken: string;
let ownerRefreshToken: string;

const SEED_SUFFIX = "m0test.local";
// Matches SEED_PASSWORD in packages/database/prisma/seed.ts.
const SEED_PASSWORD = "DevPassword123!";

beforeAll(async () => {
  testDb = await startTestDatabase();

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDb.databaseUrl;
  process.env.REDIS_URL = "redis://127.0.0.1:6379"; // unused in Milestone 0, required by env schema
  process.env.JWT_ACCESS_SECRET = "test-access-secret-32-characters-min";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-characters-min";

  const { __resetEnvCacheForTests } = await import("@cinema/config");
  __resetEnvCacheForTests();

  const { prisma } = await import("@cinema/database");
  const { seedDatabase } = await import("@cinema/database/seed");
  await seedDatabase(prisma, { silent: true, emailSuffix: SEED_SUFFIX });

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module");
  const { GlobalExceptionFilter } = await import("../src/common/http-exception.filter");

  const nestApp = await NestFactory.create(AppModule, { logger: false });
  nestApp.useGlobalFilters(new GlobalExceptionFilter());
  nestApp.setGlobalPrefix("api/v1");
  await nestApp.init();
  app = nestApp;
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
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `owner@${SEED_SUFFIX}`, password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.employee.roles).toContain("OWNER");
    expect(res.body.employee.permissions).toContain("audit.log.view");

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

  it("issues a new token pair from a valid refresh token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/refresh")
      .send({ refreshToken: ownerRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
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
    const loginAgain = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `owner@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    ownerAccessToken = loginAgain.body.accessToken;
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

describe("Movie management", () => {
  let movieId: string;

  it("rejects unauthenticated movie creation", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/movies").send({
      title: "The Apartment",
      runtimeMinutes: 125,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a staff member without movie.manage at the API", async () => {
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    const res = await request(app.getHttpServer())
      .post("/api/v1/movies")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .send({ title: "The Apartment", runtimeMinutes: 125 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("validates movie input before writing", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "", runtimeMinutes: 0, status: "UNRELEASED" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects poster URLs that do not use HTTP or HTTPS", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ title: "Unsafe Poster", runtimeMinutes: 90, posterImageUrl: "ftp://example.test/poster.jpg" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("creates a movie and its audit event in the same workflow", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        title: "  The Apartment  ",
        rating: "Approved",
        runtimeMinutes: 125,
        synopsis: "An insurance clerk lends his apartment to company executives.",
        posterImageUrl: "https://example.test/posters/the-apartment.jpg",
        status: "COMING_SOON",
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("The Apartment");
    expect(res.body.runtimeMinutes).toBe(125);
    expect(res.body.status).toBe("COMING_SOON");
    movieId = res.body.id;

    const { prisma } = await import("@cinema/database");
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "movie.created", entityId: movieId },
    });
    expect(audit?.afterState).toMatchObject({ title: "The Apartment", runtimeMinutes: 125 });
  });

  it("rejects reads by staff without movie.manage", async () => {
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });

    const list = await request(app.getHttpServer())
      .get("/api/v1/movies")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
    expect(list.status).toBe(403);
    expect(list.body.code).toBe("FORBIDDEN");

    const get = await request(app.getHttpServer())
      .get(`/api/v1/movies/${movieId}`)
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`);
    expect(get.status).toBe(403);
    expect(get.body.code).toBe("FORBIDDEN");
  });

  it("lists, reads, and updates the scoped movie", async () => {
    const list = await request(app.getHttpServer())
      .get("/api/v1/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: movieId })]));

    const get = await request(app.getHttpServer())
      .get(`/api/v1/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(get.status).toBe(200);

    const update = await request(app.getHttpServer())
      .patch(`/api/v1/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ status: "NOW_PLAYING", runtimeMinutes: 126 });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ status: "NOW_PLAYING", runtimeMinutes: 126 });
  });

  it("does not disclose another tenant's movie", async () => {
    const { prisma } = await import("@cinema/database");
    const otherOrganization = await prisma.organization.create({ data: { name: "Other Cinema" } });
    const otherMovie = await prisma.movie.create({
      data: { organizationId: otherOrganization.id, title: "Tenant Secret", runtimeMinutes: 90 },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/movies/${otherMovie.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");

    const list = await request(app.getHttpServer())
      .get("/api/v1/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(list.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: otherMovie.id })]));
  });

  it("archives instead of hard-deleting a movie", async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ARCHIVED");

    const { prisma } = await import("@cinema/database");
    await expect(prisma.movie.findUnique({ where: { id: movieId } })).resolves.toMatchObject({
      status: "ARCHIVED",
    });
  });
});

describe("Customer authentication", () => {
  const email = "new-customer@m0test.local";

  it("registers a new customer account", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .send({ email, password: "customer-password-1", name: "New Customer" });

    expect(res.status).toBe(201);
    expect(res.body.customer.isGuest).toBe(false);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("rejects registering the same email twice (409 conflict)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .send({ email, password: "customer-password-1", name: "New Customer" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("logs the customer in with correct credentials", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .send({ email, password: "customer-password-1" });

    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe(email);
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
