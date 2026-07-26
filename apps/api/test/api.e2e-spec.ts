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

const SEED_SUFFIX = "m0test.local";
// Matches SEED_PASSWORD in packages/database/prisma/seed.ts.
const SEED_PASSWORD = "DevPassword123!";

beforeAll(async () => {
  try {
  testDb = await startTestDatabase();

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDb.databaseUrl;
  process.env.REDIS_URL = "redis://127.0.0.1:6379"; // unused in Milestone 0, required by env schema
  process.env.JWT_ACCESS_SECRET = "test-access-secret-32-characters-min";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-characters-min";

  const { __resetEnvCacheForTests } = await import("../../../packages/config/src/env");
  __resetEnvCacheForTests();

  const { prisma } = await import("@cinema/database");
  const { seedDatabase } = await import("../../../packages/database/prisma/seed");
  await seedDatabase(prisma, { silent: true, emailSuffix: SEED_SUFFIX });

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module");
  const { GlobalExceptionFilter } = await import("../src/common/http-exception.filter");

  const nestApp = await NestFactory.create(AppModule, { logger: false });
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

describe("Milestone 1 cinema configuration", () => {
  let auditoriumId: string;
  let movieId: string;
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
      .send({ movieId, auditoriumId, startsAt, onSale: true });
    expect(res.status).toBe(201);
    expect(res.body.featureStartsAt).toBe("2030-01-01T18:30:00.000Z");
    expect(res.body.endsAt).toBe("2030-01-01T20:30:00.000Z");
    expect(res.body.roomReadyAt).toBe("2030-01-01T20:45:00.000Z");
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
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/cinema/showtimes/${secondShowtimeId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ startsAt: "2030-01-02T18:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.featureStartsAt).toBe("2030-01-02T18:30:00.000Z");
    expect(res.body.roomReadyAt).toBe("2030-01-02T20:45:00.000Z");
  });

  it("lists real on-sale showtimes publicly", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/cinema/now-playing");
    expect(res.status).toBe(200);
    expect(res.body.movies.some((movie: { title: string }) => movie.title === "Integration Feature")).toBe(true);
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
  const showtimeId = "31000000-0000-0000-0002-000000000001";

  it("creates one authoritative inventory row per seat", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`);
    expect(res.status).toBe(200);
    expect(res.body.seats).toHaveLength(96);
    expect(res.body.seats.every((seat: { state: string }) => seat.state === "AVAILABLE")).toBe(true);
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
