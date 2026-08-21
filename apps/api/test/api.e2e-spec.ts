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

async function loginPlatformOwner() {
  return request(app.getHttpServer())
    .post("/api/v1/platform/auth/login")
    .send({ email: "platform@attend.test", password: SEED_PASSWORD });
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
  process.env.CHECKOUT_RATE_LIMIT_ATTEMPTS = "1000";

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

describe("Saved schedule plan publishing", () => {
  it("replays concurrent attempts to save the same schedule plan", async () => {
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const requestId = crypto.randomUUID();
    const body = {
      name: `Replay-safe plan ${Date.now()}`,
      weekStartsAt: "2034-12-04T00:00:00.000Z",
    };
    const submit = () =>
      request(app.getHttpServer())
        .post("/api/v1/cinema/schedule-plans")
        .set(auth)
        .set("Idempotency-Key", requestId)
        .send(body);

    const [created, replayed] = await Promise.all([submit(), submit()]);

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${created.body.id}`)
      .set(auth)
      .expect(200);
  });

  it("replays concurrent attempts to duplicate a schedule plan", async () => {
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const source = await request(app.getHttpServer())
      .post("/api/v1/cinema/schedule-plans")
      .set(auth)
      .send({
        name: `Duplicate source ${Date.now()}`,
        weekStartsAt: "2034-12-11T00:00:00.000Z",
      })
      .expect(201);
    const requestId = crypto.randomUUID();
    const copyName = `Replay-safe copy ${Date.now()}`;
    const submit = () =>
      request(app.getHttpServer())
        .post(`/api/v1/cinema/schedule-plans/${source.body.id}/duplicate`)
        .set(auth)
        .set("Idempotency-Key", requestId)
        .send({ name: copyName });

    const [created, replayed] = await Promise.all([submit(), submit()]);

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${created.body.id}`)
      .set(auth)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${source.body.id}`)
      .set(auth)
      .expect(200);
  });

  it("replays a schedule-plan rename and rejects a stale name", async () => {
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const originalName = `Rename source ${Date.now()}`;
    const renamedName = `Rename target ${Date.now()}`;
    const plan = await request(app.getHttpServer())
      .post("/api/v1/cinema/schedule-plans")
      .set(auth)
      .send({
        name: originalName,
        weekStartsAt: "2034-12-11T00:00:00.000Z",
      })
      .expect(201);
    const requestId = crypto.randomUUID();
    const rename = () =>
      request(app.getHttpServer())
        .patch(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
        .set(auth)
        .set("Idempotency-Key", requestId)
        .send({ name: renamedName, expectedName: originalName });

    const [renamed, replayed] = await Promise.all([rename(), rename()]);

    expect(renamed.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(renamed.body.name).toBe(renamedName);
    expect(replayed.body.id).toBe(renamed.body.id);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
      .set(auth)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ name: `Stale rename ${Date.now()}`, expectedName: originalName })
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
      .set(auth)
      .expect(200);
  });

  it("replays concurrent attempts to delete a schedule plan", async () => {
    const { prisma } = await import("@cinema/database");
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const plan = await request(app.getHttpServer())
      .post("/api/v1/cinema/schedule-plans")
      .set(auth)
      .send({
        name: `Deletion replay ${Date.now()}`,
        weekStartsAt: "2034-12-18T00:00:00.000Z",
      })
      .expect(201);
    const requestId = crypto.randomUUID();
    const remove = () =>
      request(app.getHttpServer())
        .delete(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
        .set(auth)
        .set("Idempotency-Key", requestId);

    const [deleted, replayed] = await Promise.all([remove(), remove()]);

    expect(deleted.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true });
    expect(replayed.body).toEqual(deleted.body);
    expect(
      await prisma.auditEvent.count({
        where: { action: "schedule_plan.deleted", entityId: plan.body.id },
      }),
    ).toBe(1);
  });

  it("replays a saved-showing removal without deleting the next item", async () => {
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const bootstrap = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set(auth)
      .expect(200);
    const movie = bootstrap.body.location.organization.movies[0];
    const auditorium = bootstrap.body.location.auditoriums[0];
    const priceTier = bootstrap.body.location.organization.priceTiers[0];
    const plan = await request(app.getHttpServer())
      .post("/api/v1/cinema/schedule-plans")
      .set(auth)
      .send({
        name: `Removal replay ${Date.now()}`,
        weekStartsAt: "2034-12-18T00:00:00.000Z",
      })
      .expect(201);
    const addShowing = (startsAt: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/cinema/schedule-plans/${plan.body.id}/showtimes`)
        .set(auth)
        .send({
          movieId: movie.id,
          auditoriumId: auditorium.id,
          priceTierId: priceTier.id,
          startsAt,
          onSale: false,
          presentation: "STANDARD",
          filmSeriesId: null,
          format: null,
        });
    await addShowing("2034-12-19T18:00:00.000Z").expect(201);
    await addShowing("2034-12-20T18:00:00.000Z").expect(201);
    const requestId = crypto.randomUUID();
    const remove = () =>
      request(app.getHttpServer())
        .delete(`/api/v1/cinema/schedule-plans/${plan.body.id}/showtimes/0`)
        .set(auth)
        .set("Idempotency-Key", requestId);

    const [removed, replayed] = await Promise.all([remove(), remove()]);

    expect(removed.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(removed.body.snapshotJson).toHaveLength(1);
    expect(replayed.body.snapshotJson).toEqual(removed.body.snapshotJson);
    expect(removed.body.snapshotJson[0].startsAt).toBe(
      "2034-12-20T18:00:00.000Z",
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
      .set(auth)
      .expect(200);
  });

  it("replays a saved-showing time change and rejects stale edits", async () => {
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const bootstrap = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set(auth)
      .expect(200);
    const movie = bootstrap.body.location.organization.movies[0];
    const auditorium = bootstrap.body.location.auditoriums[0];
    const priceTier = bootstrap.body.location.organization.priceTiers[0];
    const plan = await request(app.getHttpServer())
      .post("/api/v1/cinema/schedule-plans")
      .set(auth)
      .send({
        name: `Time-change replay ${Date.now()}`,
        weekStartsAt: "2034-12-25T00:00:00.000Z",
      })
      .expect(201);
    const addShowing = (startsAt: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/cinema/schedule-plans/${plan.body.id}/showtimes`)
        .set(auth)
        .send({
          movieId: movie.id,
          auditoriumId: auditorium.id,
          priceTierId: priceTier.id,
          startsAt,
          onSale: false,
          presentation: "STANDARD",
          filmSeriesId: null,
          format: null,
        });
    const originalStartsAt = "2034-12-26T18:00:00.000Z";
    const changedStartsAt = "2034-12-26T20:00:00.000Z";
    await addShowing(originalStartsAt).expect(201);
    await addShowing("2034-12-27T18:00:00.000Z").expect(201);
    const requestId = crypto.randomUUID();
    const changeTime = () =>
      request(app.getHttpServer())
        .patch(`/api/v1/cinema/schedule-plans/${plan.body.id}/showtimes/0`)
        .set(auth)
        .set("Idempotency-Key", requestId)
        .send({ startsAt: changedStartsAt, expectedStartsAt: originalStartsAt });

    const [changed, replayed] = await Promise.all([changeTime(), changeTime()]);

    expect(changed.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(changed.body.snapshotJson).toHaveLength(2);
    expect(replayed.body.snapshotJson).toEqual(changed.body.snapshotJson);
    expect(changed.body.snapshotJson[0].startsAt).toBe(changedStartsAt);
    expect(changed.body.snapshotJson[1].startsAt).toBe(
      "2034-12-27T18:00:00.000Z",
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/schedule-plans/${plan.body.id}/showtimes/0`)
      .set(auth)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        startsAt: "2034-12-26T21:00:00.000Z",
        expectedStartsAt: originalStartsAt,
      })
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/v1/cinema/schedule-plans/${plan.body.id}`)
      .set(auth)
      .expect(200);
  });

  it("requires a fresh validation and atomically publishes a future plan", async () => {
    const { prisma } = await import("@cinema/database");
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const bootstrap = await request(app.getHttpServer()).get("/api/v1/cinema/admin/bootstrap").set(auth).expect(200);
    const movie = bootstrap.body.location.organization.movies[0];
    const auditorium = bootstrap.body.location.auditoriums[0];
    const priceTier = bootstrap.body.location.organization.priceTiers[0];
    const weekStartsAt = "2035-01-01T00:00:00.000Z";
    const startsAt = "2035-01-02T18:00:00.000Z";
    const createdPlan = await request(app.getHttpServer()).post("/api/v1/cinema/schedule-plans").set(auth).send({ name: `Publish test ${Date.now()}`, weekStartsAt }).expect(201);
    const planId = createdPlan.body.id as string;
    const addRequestId = crypto.randomUUID();
    const addShowing = () => request(app.getHttpServer())
      .post(`/api/v1/cinema/schedule-plans/${planId}/showtimes`)
      .set(auth)
      .set("Idempotency-Key", addRequestId)
      .send({
        movieId: movie.id, auditoriumId: auditorium.id, priceTierId: priceTier.id, startsAt,
        onSale: false, presentation: "STANDARD", filmSeriesId: null, format: null,
      });
    const [added, replayedAdd] = await Promise.all([addShowing(), addShowing()]);
    expect(added.status).toBe(201);
    expect(replayedAdd.status).toBe(201);
    expect(replayedAdd.body.snapshotJson).toEqual(added.body.snapshotJson);

    const firstCheck = await request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/validate`).set(auth).expect(201);
    expect(firstCheck.body).toEqual(expect.objectContaining({ valid: true, showtimeCount: 1, expectedUpdatedAt: expect.any(String) }));
    await request(app.getHttpServer()).patch(`/api/v1/cinema/schedule-plans/${planId}`).set(auth).set("Idempotency-Key", crypto.randomUUID()).send({ name: `Renamed publish test ${Date.now()}`, expectedName: createdPlan.body.name }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/publish`).set(auth).send({ expectedUpdatedAt: firstCheck.body.expectedUpdatedAt }).expect(409);

    const freshCheck = await request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/validate`).set(auth).expect(201);
    const publishRequestId = crypto.randomUUID();
    const publish = () => request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/publish`).set(auth).set("Idempotency-Key", publishRequestId).send({ expectedUpdatedAt: freshCheck.body.expectedUpdatedAt });
    const [published, replayedPublish] = await Promise.all([publish(), publish()]);
    expect(published.status).toBe(201);
    expect(replayedPublish.status).toBe(201);
    expect(published.body).toEqual({ published: true, preservedCount: 0, createdCount: 1, removedCount: 0 });
    expect(replayedPublish.body).toEqual(published.body);
    expect(await prisma.auditEvent.count({ where: { action: "schedule_plan.published", entityId: planId } })).toBe(1);
    const refreshed = await request(app.getHttpServer()).get("/api/v1/cinema/admin/bootstrap").set(auth).expect(200);
    const live = refreshed.body.showtimes.find((showtime: { startsAt: string }) => showtime.startsAt === startsAt);
    expect(live).toEqual(expect.objectContaining({ onSale: false, movie: expect.objectContaining({ id: movie.id }), auditorium: expect.objectContaining({ id: auditorium.id }) }));

    await request(app.getHttpServer()).delete(`/api/v1/cinema/showtimes/${live.id}`).set(auth).expect(200);
    await request(app.getHttpServer()).delete(`/api/v1/cinema/schedule-plans/${planId}`).set(auth).expect(200);
  });

  it("rejects a plan when its auditorium has no active seat layout", async () => {
    const { prisma } = await import("@cinema/database");
    const login = await loginOwner();
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const bootstrap = await request(app.getHttpServer()).get("/api/v1/cinema/admin/bootstrap").set(auth).expect(200);
    const movie = bootstrap.body.location.organization.movies[0];
    const auditorium = bootstrap.body.location.auditoriums[0];
    const priceTier = bootstrap.body.location.organization.priceTiers[0];
    const createdPlan = await request(app.getHttpServer()).post("/api/v1/cinema/schedule-plans").set(auth).send({
      name: `Seat layout validation ${Date.now()}`,
      weekStartsAt: "2035-02-05T00:00:00.000Z",
    }).expect(201);
    const planId = createdPlan.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/showtimes`).set(auth).send({
      movieId: movie.id,
      auditoriumId: auditorium.id,
      priceTierId: priceTier.id,
      startsAt: "2035-02-06T18:00:00.000Z",
      onSale: false,
      presentation: "STANDARD",
      filmSeriesId: null,
      format: null,
    }).expect(201);

    const seats = await prisma.seat.findMany({
      where: { seatMap: { auditoriumId: auditorium.id } },
      select: { id: true, active: true },
    });
    expect(seats.length).toBeGreaterThan(0);

    try {
      await prisma.seat.updateMany({
        where: { id: { in: seats.map((seat) => seat.id) } },
        data: { active: false },
      });
      const validation = await request(app.getHttpServer()).post(`/api/v1/cinema/schedule-plans/${planId}/validate`).set(auth).expect(201);
      expect(validation.body).toEqual(expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ message: "Auditorium has no sellable ticket inventory." }),
        ]),
      }));
    } finally {
      const originallyActive = seats.filter((seat) => seat.active).map((seat) => seat.id);
      const originallyInactive = seats.filter((seat) => !seat.active).map((seat) => seat.id);
      if (originallyActive.length) {
        await prisma.seat.updateMany({ where: { id: { in: originallyActive } }, data: { active: true } });
      }
      if (originallyInactive.length) {
        await prisma.seat.updateMany({ where: { id: { in: originallyInactive } }, data: { active: false } });
      }
      await request(app.getHttpServer()).delete(`/api/v1/cinema/schedule-plans/${planId}`).set(auth).expect(200);
    }
  });
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

describe("Private event inquiries", () => {
  it("replays concurrent submissions once and rejects key reuse with different details", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const email = `private-event-${crypto.randomUUID()}@example.test`;
    const payload = { name: "Replay Guest", email, eventType: "Private screening", message: "A safe retry test." };
    const submit = () => request(app.getHttpServer()).post("/api/v1/cinema/private-event-inquiries").set("Idempotency-Key", requestId).send(payload);

    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body.id).toBe(replay.body.id);
    expect(await prisma.privateEventInquiry.count({ where: { email } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "private_event_inquiry.created", entityId: first.body.id } })).toBe(1);

    const conflict = await request(app.getHttpServer()).post("/api/v1/cinema/private-event-inquiries").set("Idempotency-Key", requestId).send({ ...payload, message: "Different details." });
    expect(conflict.status).toBe(409);
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

  it("reuses an unfinished MFA setup secret when the response must be retried", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findUniqueOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const previousMfa = await prisma.staffAuthAccount.findUniqueOrThrow({
      where: { employeeId: owner.id },
      select: { mfaEnabled: true, mfaSecretEncrypted: true },
    });
    await prisma.staffAuthAccount.update({
      where: { employeeId: owner.id },
      data: { mfaEnabled: false, mfaSecretEncrypted: null },
    });
    const beginSetup = () => request(app.getHttpServer())
      .post("/api/v1/auth/staff/mfa/setup")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    try {
      const first = await beginSetup().expect(200);
      const replay = await beginSetup().expect(200);
      expect(replay.body).toEqual(first.body);
      expect(first.body.secret).toEqual(expect.any(String));
      expect(first.body.uri).toContain(encodeURIComponent(`owner@${SEED_SUFFIX}`));
    } finally {
      await prisma.staffAuthAccount.update({ where: { employeeId: owner.id }, data: previousMfa });
    }
  });

  it("replays concurrent employee creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const people = await request(app.getHttpServer()).get("/api/v1/management/people").set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    const role = people.body.roles.find((item: { key: string }) => item.key === "SERVER");
    const email = `employee-replay-${crypto.randomUUID()}@${SEED_SUFFIX}`;
    const requestId = crypto.randomUUID();
    const submit = () => request(app.getHttpServer())
      .post("/api/v1/management/employees")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ name: "Replay Employee", email, password: SEED_PASSWORD, pin: "2468", roleIds: [role.id] });
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.employee.count({ where: { email } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "employee.created", entityId: first.body.id } })).toBe(1);
    const updateRequestId = crypto.randomUUID();
    const update = () => request(app.getHttpServer())
      .patch(`/api/v1/management/employees/${first.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", updateRequestId)
      .send({ name: "Updated Replay Employee", roleIds: [role.id] });
    const [updated, replayedUpdate] = await Promise.all([update(), update()]);
    expect(updated.status).toBe(200);
    expect(replayedUpdate.body).toEqual(updated.body);
    expect(await prisma.auditEvent.count({ where: { action: "employee.access_updated", entityId: first.body.id } })).toBe(1);
    const credentialsRequestId = crypto.randomUUID();
    const resetCredentials = () => request(app.getHttpServer())
      .patch(`/api/v1/management/employees/${first.body.id}/credentials`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", credentialsRequestId)
      .send({ pin: "1357" });
    const beforeAccount = await prisma.staffAuthAccount.findUniqueOrThrow({
      where: { employeeId: first.body.id },
      select: { refreshTokenVersion: true },
    });
    const [reset, replayedReset] = await Promise.all([resetCredentials(), resetCredentials()]);
    expect(reset.status).toBe(200);
    expect(replayedReset.body).toEqual(reset.body);
    const afterAccount = await prisma.staffAuthAccount.findUniqueOrThrow({
      where: { employeeId: first.body.id },
      select: { refreshTokenVersion: true },
    });
    expect(afterAccount.refreshTokenVersion).toBe(beforeAccount.refreshTokenVersion + 1);
    expect(await prisma.auditEvent.count({ where: { action: "employee.credentials_reset", entityId: first.body.id } })).toBe(1);
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

    const temporary = await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: updatedEmail.toUpperCase(), password: "TemporaryPassword123!" }).expect(200);
    expect(temporary.body.employee.mustChangePassword).toBe(true);
    expect(temporary.body.employee.permissions).toEqual([]);
    await request(app.getHttpServer()).get("/api/v1/audit-events").set("Authorization", `Bearer ${temporary.body.accessToken}`).expect(403);

    const { prisma } = await import("@cinema/database");
    const beforePasswordChange = await prisma.staffAuthAccount.findUniqueOrThrow({ where: { employeeId: server.body.id } });
    const passwordChangeRequestId = crypto.randomUUID();
    const changePassword = () => request(app.getHttpServer())
      .post("/api/v1/auth/staff/change-password")
      .set("Authorization", `Bearer ${temporary.body.accessToken}`)
      .set("Idempotency-Key", passwordChangeRequestId)
      .send({ currentPassword: "TemporaryPassword123!", newPassword: SEED_PASSWORD });
    const changed = await changePassword().expect(200);
    const replayedChange = await changePassword().expect(200);
    expect(changed.body.employee.mustChangePassword).toBe(false);
    expect(changed.body.employee.permissions.length).toBeGreaterThan(0);
    expect(replayedChange.body.employee).toEqual(changed.body.employee);
    const afterPasswordChange = await prisma.staffAuthAccount.findUniqueOrThrow({ where: { employeeId: server.body.id } });
    expect(afterPasswordChange.refreshTokenVersion).toBe(beforePasswordChange.refreshTokenVersion + 1);
    expect(await prisma.auditEvent.count({ where: { action: "employee.password_changed", entityId: server.body.id } })).toBe(1);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/refresh").send({ refreshToken: temporary.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).post("/api/v1/auth/staff/login").send({ email: updatedEmail, password: SEED_PASSWORD }).expect(200);

    await request(app.getHttpServer()).patch(`/api/v1/management/employees/${server.body.id}/credentials`).set("Authorization", `Bearer ${ownerAccessToken}`).send({ pin: "1234" }).expect(200);
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
    const csv = await request(app.getHttpServer()).get(`/api/v1/platform/revenue.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set("Authorization", `Bearer ${platformAccessToken}`).expect(200).expect("Content-Type", /text\/csv/);
    expect(csv.text).toContain('"Client","Locations","Tickets sold"');
    expect(csv.text).toContain('"TOTAL"');
    expect(csv.text).toContain('"Meridian Cinema Co."');
    const meridianClient = res.body.clients.find((client: { name: string }) => client.name === "Meridian Cinema Co.");
    const scoped = await request(app.getHttpServer()).get(`/api/v1/platform/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&organizationId=${encodeURIComponent(meridianClient.id)}`).set("Authorization", `Bearer ${platformAccessToken}`).expect(200);
    expect(scoped.body.clients).toHaveLength(1);
    expect(scoped.body.clients[0].name).toBe("Meridian Cinema Co.");
    expect(scoped.body.totals).toEqual(expect.objectContaining({ ticketFeesCents: expect.any(Number), combinedRevenueCents: expect.any(Number) }));
    await request(app.getHttpServer()).get(`/api/v1/platform/revenue?organizationId=00000000-0000-0000-0000-000000000000`).set("Authorization", `Bearer ${platformAccessToken}`).expect(404);
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
        auditoriums: expect.arrayContaining([expect.objectContaining({
          id: expect.any(String), name: expect.any(String), capacity: expect.any(Number), active: expect.any(Boolean),
          seatMap: expect.objectContaining({ id: expect.any(String), name: expect.any(String), version: expect.any(Number), activeSeats: expect.any(Number), accessibleSeats: expect.any(Number), companionSeats: expect.any(Number), seats: expect.any(Array) }),
        })]),
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
        businessTypeLabel: "Independent cinema",
        defaultSeatingMode: "GENERAL_ADMISSION",
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
      businessTypeLabel: "Independent cinema",
      defaultSeatingMode: "GENERAL_ADMISSION",
      locations: [expect.objectContaining({
        name: "Bluebird Cinema",
        address: "100 Main Street, Richmond, VA",
        timezone: "America/New_York",
      })],
    }));
  });

  it("only permanently deletes suspended clients without linked records", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/platform/organizations")
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({
        name: "Disposable Preview Cinema",
        timezone: "America/Chicago",
        location: { name: "Disposable Preview", timezone: "America/Chicago" },
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/platform/organizations/${created.body.id}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/platform/organizations/${created.body.id}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .send({ active: false })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/platform/organizations/${created.body.id}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(expect.objectContaining({ deleted: true, id: created.body.id })));

    await request(app.getHttpServer())
      .get(`/api/v1/platform/organizations/${created.body.id}`)
      .set("Authorization", `Bearer ${platformAccessToken}`)
      .expect(404);
  });

  it("lets an Attend operator create a validated auditorium for a client location", async () => {
    const platformLogin = await loginPlatformOwner();
    expect(platformLogin.status).toBe(200);
    const accessToken = platformLogin.body.accessToken as string;
    const overview = await request(app.getHttpServer()).get("/api/v1/platform/overview").set("Authorization", `Bearer ${accessToken}`).expect(200);
    const organization = overview.body.organizations.find((candidate: { name: string }) => candidate.name === "Meridian Cinema Co.");
    const locationId = organization.locations[0].id as string;
    const payload = {
      name: "Master Preview Room",
      seatMapName: "Master Preview Layout",
      seats: [
        { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD" },
        { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "ADA" },
      ],
    };

    await request(app.getHttpServer()).post(`/api/v1/platform/organizations/${organization.id}/locations/${locationId}/auditoriums`).send(payload).expect(401);
    const created = await request(app.getHttpServer()).post(`/api/v1/platform/organizations/${organization.id}/locations/${locationId}/auditoriums`).set("Authorization", `Bearer ${accessToken}`).send(payload).expect(201);
    expect(created.body).toEqual(expect.objectContaining({ name: payload.name, capacity: 2, seatMap: expect.objectContaining({ name: payload.seatMapName, seats: expect.arrayContaining([expect.objectContaining({ label: "A1" }), expect.objectContaining({ label: "A2", type: "ADA" })]) }) }));

    const duplicated = await request(app.getHttpServer()).post(`/api/v1/platform/organizations/${organization.id}/locations/${locationId}/auditoriums/${created.body.id}/duplicate`).set("Authorization", `Bearer ${accessToken}`).send({ name: "Master Preview Room copy" }).expect(201);
    expect(duplicated.body).toEqual(expect.objectContaining({ name: "Master Preview Room copy", capacity: 2, seatMap: expect.objectContaining({ seats: expect.arrayContaining([expect.objectContaining({ label: "A1" }), expect.objectContaining({ label: "A2", type: "ADA" })]) }) }));
    await request(app.getHttpServer()).delete(`/api/v1/platform/organizations/${organization.id}/locations/${locationId}/auditoriums/${duplicated.body.id}`).set("Authorization", `Bearer ${accessToken}`).expect(200).expect(({ body }) => expect(body.active).toBe(false));

    await request(app.getHttpServer()).post(`/api/v1/platform/organizations/00000000-0000-0000-0000-000000000000/locations/${locationId}/auditoriums`).set("Authorization", `Bearer ${accessToken}`).send({ ...payload, name: "Wrong tenant" }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/platform/organizations/${organization.id}/locations/${locationId}/auditoriums`).set("Authorization", `Bearer ${accessToken}`).send({ ...payload, name: "Invalid room", seats: [{ ...payload.seats[0], label: "A1" }, { ...payload.seats[1], label: "A1" }] }).expect(400);
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
      .send({
        legalName: "Meridian Cinema Co. LLC",
        businessTypeLabel: "Dine-in cinema",
        defaultSeatingMode: "GENERAL_ADMISSION",
      })
      .expect(200);
    expect(organization.body).toEqual(expect.objectContaining({
      legalName: "Meridian Cinema Co. LLC",
      businessTypeLabel: "Dine-in cinema",
      defaultSeatingMode: "GENERAL_ADMISSION",
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
    const { prisma } = await import("@cinema/database");
    const name = `Floor manager ${crypto.randomUUID()}`;
    const requestId = crypto.randomUUID();
    const create = () => request(app.getHttpServer())
      .post("/api/v1/management/roles")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ name });
    const [created, replayed] = await Promise.all([create(), create()]);

    expect(created.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body).toEqual(created.body);
    expect(created.body.name).toBe(name);
    expect(created.body.key).toMatch(/^CUSTOM_[A-F0-9]{32}$/);
    expect(await prisma.role.count({ where: { name } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "role.created", entityId: created.body.id } })).toBe(1);
    const permissionsRequestId = crypto.randomUUID();
    const updatePermissions = () => request(app.getHttpServer())
      .patch(`/api/v1/management/roles/${created.body.id}/permissions`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", permissionsRequestId)
      .send({ permissionKeys: ["showtime.manage", "ticket.refund"] });
    const [permissions, replayedPermissions] = await Promise.all([updatePermissions(), updatePermissions()]);
    expect(permissions.status).toBe(200);
    expect(replayedPermissions.body).toEqual(permissions.body);
    expect(await prisma.auditEvent.count({ where: { action: "role.permissions_updated", entityId: created.body.id } })).toBe(1);
    const people = await request(app.getHttpServer())
      .get("/api/v1/management/people")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(people.body.roles.find((role: { id: string }) => role.id === created.body.id).rolePermissions.map((entry: { permission: { key: string } }) => entry.permission.key).sort()).toEqual(["showtime.manage", "ticket.refund"]);
    const renamed = `${name} renamed`;
    const renameRequestId = crypto.randomUUID();
    const rename = () => request(app.getHttpServer())
      .patch(`/api/v1/management/roles/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", renameRequestId)
      .send({ name: renamed });
    const [renamedRole, replayedRename] = await Promise.all([rename(), rename()]);
    expect(renamedRole.status).toBe(200);
    expect(replayedRename.body).toEqual(renamedRole.body);
    expect(renamedRole.body.name).toBe(renamed);
    expect(await prisma.auditEvent.count({ where: { action: "role.renamed", entityId: created.body.id } })).toBe(1);
    const deleteRequestId = crypto.randomUUID();
    const remove = () => request(app.getHttpServer())
      .delete(`/api/v1/management/roles/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", deleteRequestId);
    const [deleted, replayedDelete] = await Promise.all([remove(), remove()]);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ id: created.body.id, deleted: true });
    expect(replayedDelete.body).toEqual(deleted.body);
    expect(await prisma.auditEvent.count({ where: { action: "role.deleted", entityId: created.body.id } })).toBe(1);
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
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = {
      name: "Integration Theater",
      seatMapName: "Integration paired layout",
      seats: [
        { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD", tableGroupId: "A-1", tablePosition: "LEFT" },
        { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD", tableGroupId: "A-1", tablePosition: "RIGHT" },
      ],
    };
    const create = () => request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(payload);
    const [res, replayed] = await Promise.all([create(), create()]);
    expect(res.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(res.body.id);
    expect(res.body.capacity).toBe(2);
    expect(res.body.seatMap.seats).toHaveLength(2);
    auditoriumId = res.body.id;
    expect(await prisma.auditorium.count({ where: { id: auditoriumId } })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: "auditorium.created", entityId: auditoriumId },
    })).toBe(1);
    await request(app.getHttpServer())
      .post("/api/v1/cinema/auditoriums")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ ...payload, name: "Different Theater" })
      .expect(409);
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
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = { title: "Integration Feature", runtimeMinutes: 120, rating: "PG-13" };
    const create = () => request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(payload);
    const [res, replayed] = await Promise.all([create(), create()]);
    expect(res.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(res.body.id);
    expect(res.body.runtimeMinutes).toBe(120);
    movieId = res.body.id;
    expect(await prisma.movie.count({ where: { id: movieId } })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: "movie.created", entityId: movieId },
    })).toBe(1);
    await request(app.getHttpServer())
      .post("/api/v1/cinema/movies")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ ...payload, runtimeMinutes: 121 })
      .expect(409);
  });

  it("replays a movie update and rejects a stale editor save", async () => {
    const { prisma } = await import("@cinema/database");
    const before = await prisma.movie.findUniqueOrThrow({ where: { id: movieId } });
    const requestId = crypto.randomUUID();
    const update = () => request(app.getHttpServer())
      .patch(`/api/v1/cinema/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .set("If-Unmodified-Since", before.updatedAt.toISOString())
      .send({ synopsis: "Updated exactly once." });
    const [updated, replayed] = await Promise.all([update(), update()]);
    expect(updated.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(replayed.body.id).toBe(updated.body.id);
    expect(updated.body.synopsis).toBe("Updated exactly once.");
    expect(await prisma.auditEvent.count({
      where: { action: "movie.updated", entityId: movieId },
    })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/movies/${movieId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .set("If-Unmodified-Since", before.updatedAt.toISOString())
      .send({ synopsis: "Stale overwrite." })
      .expect(409);
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

  it("replays concurrent showtime creation with one seat inventory", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = { movieId, auditoriumId, startsAt: "2030-01-03T18:00:00.000Z", onSale: true };
    const submit = () => request(app.getHttpServer()).post("/api/v1/cinema/showtimes").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(payload);
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.showtime.count({ where: { id: first.body.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "showtime.created", entityId: first.body.id } })).toBe(1);
    expect(await prisma.showtimeSeat.count({ where: { showtimeId: first.body.id } })).toBeGreaterThan(0);
    await prisma.showtime.delete({ where: { id: first.body.id } });
  });

  it("versions an advanced layout without changing seats on an existing showtime", async () => {
    const { prisma } = await import("@cinema/database");
    const before = await prisma.showtimeSeat.findMany({ where: { showtimeId: firstShowtimeId }, orderBy: { seatId: "asc" } });
    const requestId = crypto.randomUUID();
    const payload = {
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
    };
    const update = () => request(app.getHttpServer())
      .patch(`/api/v1/cinema/auditoriums/${auditoriumId}/layout`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .set("If-Match", "1")
      .send(payload);
    const [res, replayed] = await Promise.all([update(), update()]);
    expect(res.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(replayed.body.id).toBe(res.body.id);
    expect(res.body.seatMap.version).toBe(2);
    expect(res.body.seatMap.seats.every((seat: { layoutVersion: number }) => seat.layoutVersion === 2)).toBe(true);
    const after = await prisma.showtimeSeat.findMany({ where: { showtimeId: firstShowtimeId }, orderBy: { seatId: "asc" } });
    expect(after.map((seat) => seat.seatId)).toEqual(before.map((seat) => seat.seatId));
    expect(await prisma.seat.count({ where: { seatMap: { auditoriumId }, layoutVersion: 1, active: false } })).toBe(2);
    expect(await prisma.auditEvent.count({
      where: { action: "auditorium.layout_version_created", entityId: auditoriumId },
    })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/auditoriums/${auditoriumId}/layout`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .set("If-Match", "1")
      .send({ ...payload, name: "Different layout details" })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/auditoriums/${auditoriumId}/layout`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .set("If-Match", "1")
      .send(payload)
      .expect(409);
  });

  it("replays concurrent auditorium duplication", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = { name: "Integration Theater copy" };
    const duplicate = () => request(app.getHttpServer())
      .post(`/api/v1/cinema/auditoriums/${auditoriumId}/duplicate`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(payload);
    const [copy, replayed] = await Promise.all([duplicate(), duplicate()]);
    expect(copy.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(copy.body.id);
    expect(replayed.body.seatMap.seats).toHaveLength(copy.body.seatMap.seats.length);
    expect(await prisma.auditorium.count({ where: { id: copy.body.id } })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: "auditorium.duplicated", entityId: copy.body.id },
    })).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/v1/cinema/auditoriums/${auditoriumId}/duplicate`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ name: "Different copy" })
      .expect(409);
    await prisma.auditEvent.deleteMany({ where: { entityId: copy.body.id } });
    await prisma.auditorium.delete({ where: { id: copy.body.id } });
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
    const requestId = crypto.randomUUID();
    const update = () => request(app.getHttpServer())
      .patch(`/api/v1/cinema/showtimes/${secondShowtimeId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .set("If-Unmodified-Since", before.updatedAt.toISOString())
      .send({ startsAt: "2030-01-02T18:00:00.000Z" });
    const [res, replayed] = await Promise.all([update(), update()]);
    expect(res.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(replayed.body.id).toBe(res.body.id);
    expect(res.body.featureStartsAt).toBe("2030-01-02T18:30:00.000Z");
    expect(res.body.roomReadyAt).toBe("2030-01-02T20:45:00.000Z");
    expect(res.body.priceTier.id).toBe(before.priceTierId);
    const after = await prisma.showtime.findUniqueOrThrow({ where: { id: secondShowtimeId } });
    expect(after.priceTierId).toBe(before.priceTierId);
    expect(await prisma.auditEvent.count({ where: { action: "showtime.updated", entityId: secondShowtimeId } })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/showtimes/${secondShowtimeId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .set("If-Unmodified-Since", before.updatedAt.toISOString())
      .send({ startsAt: "2030-01-02T19:00:00.000Z" })
      .expect(409);
  });

  it("replays a concurrent showtime group move exactly once", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = {
      moves: [
        {
          showtimeId: firstShowtimeId,
          auditoriumId,
          startsAt: "2030-01-03T18:00:00.000Z",
        },
        {
          showtimeId: secondShowtimeId,
          auditoriumId,
          startsAt: "2030-01-04T18:00:00.000Z",
        },
      ],
    };
    const move = () => request(app.getHttpServer())
      .patch("/api/v1/cinema/showtimes/group")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(payload);
    const [moved, replayed] = await Promise.all([move(), move()]);
    expect(moved.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(moved.body.showtimes).toHaveLength(2);
    expect(replayed.body.showtimes).toHaveLength(2);
    expect(await prisma.auditEvent.count({
      where: {
        action: "showtime.group_moved",
        entityId: { in: [firstShowtimeId, secondShowtimeId] },
      },
    })).toBe(2);
    await request(app.getHttpServer())
      .patch("/api/v1/cinema/showtimes/group")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({
        moves: [
          { ...payload.moves[0], startsAt: "2030-01-03T19:00:00.000Z" },
          payload.moves[1],
        ],
      })
      .expect(409);
  });

  it("includes the required price tier relation in the admin schedule", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/cinema/admin/bootstrap")
      .set("Authorization", `Bearer ${ownerAccessToken}`);
    expect(res.status).toBe(200);
    const showtime = res.body.showtimes.find((item: { id: string }) => item.id === secondShowtimeId);
    expect(showtime.priceTier.id).toBeTruthy();
  });

  it("keeps complete past schedule days available to Admin", async () => {
    const { prisma } = await import("@cinema/database");
    const reference = await prisma.showtime.findUniqueOrThrow({
      where: { id: secondShowtimeId },
      include: { auditorium: true },
    });
    const archivedAuditorium = await prisma.auditorium.create({
      data: {
        locationId: reference.auditorium.locationId,
        name: `Archived history room ${Date.now()}`,
        capacity: 40,
        active: false,
      },
    });
    const historical = await prisma.showtime.create({
      data: {
        movieId,
        auditoriumId: archivedAuditorium.id,
        priceTierId: reference.priceTierId,
        startsAt: new Date("2029-12-20T18:00:00.000Z"),
        featureStartsAt: new Date("2029-12-20T18:30:00.000Z"),
        endsAt: new Date("2029-12-20T20:30:00.000Z"),
        roomReadyAt: new Date("2029-12-20T20:45:00.000Z"),
        onSale: false,
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .get("/api/v1/cinema/admin/bootstrap")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .expect(200);
      expect(res.body.showtimes.some((item: { id: string }) => item.id === historical.id)).toBe(true);
      expect(res.body.location.auditoriums.some((item: { id: string }) => item.id === archivedAuditorium.id)).toBe(false);
    } finally {
      await prisma.showtime.delete({ where: { id: historical.id } });
      await prisma.auditorium.delete({ where: { id: archivedAuditorium.id } });
    }
  });

  it("lists active film series with their explicitly assigned future showtimes", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const payload = {
      name: "Public Classics",
      description: "A managed repertory program.",
      artworkUrl: "https://example.com/public-classics.jpg",
    };
    const create = () => request(app.getHttpServer())
      .post("/api/v1/cinema/film-series")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(payload);
    const [series, replayed] = await Promise.all([create(), create()]);
    expect(series.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body.id).toBe(series.body.id);
    expect(await prisma.filmSeries.count({ where: { id: series.body.id } })).toBe(1);
    expect(await prisma.auditEvent.count({
      where: { action: "film_series.created", entityId: series.body.id },
    })).toBe(1);
    await request(app.getHttpServer())
      .post("/api/v1/cinema/film-series")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ ...payload, description: "Different details." })
      .expect(409);

    const updateRequestId = crypto.randomUUID();
    const updatePayload = { description: "A managed repertory program with encores." };
    const update = () => request(app.getHttpServer())
      .patch(`/api/v1/cinema/film-series/${series.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", updateRequestId)
      .set("If-Unmodified-Since", series.body.updatedAt)
      .send(updatePayload);
    const [updated, updateReplay] = await Promise.all([update(), update()]);
    expect(updated.status).toBe(200);
    expect(updateReplay.status).toBe(200);
    expect(updateReplay.body.id).toBe(updated.body.id);
    expect(await prisma.auditEvent.count({
      where: { action: "film_series.updated", entityId: series.body.id },
    })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/film-series/${series.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", updateRequestId)
      .set("If-Unmodified-Since", series.body.updatedAt)
      .send({ description: "Different update details." })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/cinema/film-series/${series.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", crypto.randomUUID())
      .set("If-Unmodified-Since", series.body.updatedAt)
      .send({ artworkUrl: "https://example.com/stale-artwork.jpg" })
      .expect(409);

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
      description: "A managed repertory program with encores.",
      artworkUrl: "https://example.com/public-classics.jpg",
    }));
    const movie = publicSeries.movies.find((entry: { id: string }) => entry.id === movieId);
    expect(movie.title).toBe("Integration Feature");
    expect(movie.showtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: secondShowtimeId, presentation: "Q_AND_A" }),
    ]));

    const archiveRequestId = crypto.randomUUID();
    const archive = () => request(app.getHttpServer())
      .delete(`/api/v1/cinema/film-series/${series.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", archiveRequestId);
    const [archived, archiveReplay] = await Promise.all([archive(), archive()]);
    expect(archived.status).toBe(200);
    expect(archiveReplay.status).toBe(200);
    expect(archiveReplay.body.id).toBe(archived.body.id);
    expect(archived.body.active).toBe(false);
    expect(await prisma.auditEvent.count({
      where: { action: "film_series.archived", entityId: series.body.id },
    })).toBe(1);

    const restoreRequestId = crypto.randomUUID();
    const restore = () => request(app.getHttpServer())
      .post(`/api/v1/cinema/film-series/${series.body.id}/restore`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", restoreRequestId);
    const [restored, restoreReplay] = await Promise.all([restore(), restore()]);
    expect(restored.status).toBe(201);
    expect(restoreReplay.status).toBe(201);
    expect(restoreReplay.body.id).toBe(restored.body.id);
    expect(restored.body.active).toBe(true);
    expect(await prisma.auditEvent.count({
      where: { action: "film_series.restored", entityId: series.body.id },
    })).toBe(1);

    const storedSeries = await prisma.filmSeries.findUniqueOrThrow({
      where: { id: series.body.id },
      select: { organizationId: true },
    });
    const activeSeries = await prisma.filmSeries.findMany({
      where: { organizationId: storedSeries.organizationId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const seriesIds = activeSeries.map((entry) => entry.id).reverse();
    const reorderRequestId = crypto.randomUUID();
    const reorder = () => request(app.getHttpServer())
      .post("/api/v1/cinema/film-series/reorder")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", reorderRequestId)
      .send({ seriesIds });
    const [reordered, reorderReplay] = await Promise.all([reorder(), reorder()]);
    expect(reordered.status).toBe(201);
    expect(reorderReplay.status).toBe(201);
    expect(reordered.body).toEqual({ reordered: true });
    expect(await prisma.auditEvent.count({
      where: {
        action: "film_series.reordered",
        afterState: { path: ["requestId"], equals: reorderRequestId },
      },
    })).toBe(1);
    const storedOrder = await prisma.filmSeries.findMany({
      where: { id: { in: seriesIds } },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    expect(storedOrder.map((entry) => entry.id)).toEqual(seriesIds);
    if (seriesIds.length > 1) {
      await request(app.getHttpServer())
        .post("/api/v1/cinema/film-series/reorder")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .set("Idempotency-Key", reorderRequestId)
        .send({ seriesIds: [...seriesIds].reverse() })
        .expect(409);
    }
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
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const update = () => request(app.getHttpServer())
      .patch("/api/v1/management/settings/branding")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ name: "Integration Cinema", logoUrl: "https://example.com/cinema.svg", accentColor: "#123456", backgroundColor: "#101112", textColor: "#fefefe", adminAccentColor: "#654321" });
    const [updated, replayed] = await Promise.all([update(), update()]);
    expect(updated.status).toBe(200);
    expect(replayed.body).toEqual(updated.body);
    expect(updated.body).toEqual(expect.objectContaining({ name: "Integration Cinema", customerLogoUrl: "https://example.com/cinema.svg", customerAccentColor: "#123456", adminAccentColor: "#654321" }));
    expect(await prisma.auditEvent.count({ where: { action: "location.branding_updated", afterState: { path: ["requestId"], equals: requestId } } })).toBe(1);
  });

  it("validates cinema-managed branding colors", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/management/settings/branding")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ accentColor: "hotpink" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_FAILED");
  });

  it("replays concurrent merchandise-link publishing once", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const merchUrl = "https://shop.example.com/meridian";
    const publish = () => request(app.getHttpServer())
      .patch("/api/v1/management/settings/merch")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ merchUrl });
    const [updated, replayed] = await Promise.all([publish(), publish()]);
    expect(updated.status).toBe(200);
    expect(replayed.body).toEqual(updated.body);
    expect(updated.body.merchUrl).toBe(merchUrl);
    expect(await prisma.auditEvent.count({ where: { action: "location.merch_updated", afterState: { path: ["requestId"], equals: requestId } } })).toBe(1);
  });

  it("replays concurrent customer-site-copy publishing once", async () => {
    const { prisma } = await import("@cinema/database");
    const settings = await request(app.getHttpServer())
      .get("/api/v1/management/settings")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    const requestId = crypto.randomUUID();
    const copy = { ...settings.body.siteCopy, showtimes: { ...settings.body.siteCopy.showtimes, intro: "Reserve your seats for a great night out." } };
    const publish = () => request(app.getHttpServer())
      .patch("/api/v1/management/settings/site-copy")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(copy);
    const [updated, replayed] = await Promise.all([publish(), publish()]);
    expect(updated.status).toBe(200);
    expect(replayed.body).toEqual(updated.body);
    expect(updated.body.siteCopy.showtimes.intro).toBe(copy.showtimes.intro);
    expect(await prisma.auditEvent.count({ where: { action: "location.site_copy_updated", afterState: { path: ["requestId"], equals: requestId } } })).toBe(1);
  });

  it("replays concurrent menu-presentation publishing once", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const presentation = { assetUrl: "https://example.com/menu.pdf", assetType: "PDF" };
    const publish = () => request(app.getHttpServer())
      .patch("/api/v1/management/settings/menu-presentation")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(presentation);
    const [updated, replayed] = await Promise.all([publish(), publish()]);
    expect(updated.status).toBe(200);
    expect(replayed.body).toEqual(updated.body);
    expect(updated.body).toEqual(presentation);
    expect(await prisma.auditEvent.count({ where: { action: "menu.presentation_updated", afterState: { path: ["requestId"], equals: requestId } } })).toBe(1);
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
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const save = () => request(app.getHttpServer())
      .patch("/api/v1/management/settings/location")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send(update);
    const [updated, replayed] = await Promise.all([save(), save()]);
    expect(updated.status).toBe(200);
    expect(replayed.body).toEqual(updated.body);
    expect(updated.body).toEqual(expect.objectContaining(update));
    expect(await prisma.auditEvent.count({ where: { action: "location.settings_updated", afterState: { path: ["requestId"], equals: requestId } } })).toBe(1);

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

  it("replays concurrent private-event inquiry status updates once", async () => {
    const { prisma } = await import("@cinema/database");
    const created = await request(app.getHttpServer())
      .post("/api/v1/cinema/private-event-inquiries")
      .send({ name: "Status Replay Guest", email: `status-${crypto.randomUUID()}@example.test`, eventType: "Private screening", message: "Please follow up." })
      .expect(201);
    const requestId = crypto.randomUUID();
    const submit = () => request(app.getHttpServer())
      .patch(`/api/v1/management/private-event-inquiries/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ status: "CONTACTED" });
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.auditEvent.count({ where: { action: "private_event_inquiry.status_updated", entityId: created.body.id } })).toBe(1);
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

    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/management/settings/price-tiers")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: name.toUpperCase(), ticketPriceMinor: 2100 });
    expect(duplicate.status).toBe(409);

    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/price-tiers/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `${name} renamed`, active: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual(expect.objectContaining({ name: `${name} renamed`, ticketPriceMinor: 2000, active: false }));
  });

  it("lets managers create, rename, and retire customer-facing ticket types", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/management/settings/ticket-types")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Member ${Date.now()}` })
      .expect(201);
    expect(created.body).toEqual(expect.objectContaining({ active: true }));

    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/ticket-types/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Member admission ${Date.now()}`, active: false })
      .expect(200);
    expect(renamed.body).toEqual(expect.objectContaining({ active: false }));

    const settings = await request(app.getHttpServer())
      .get("/api/v1/management/settings")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(settings.body.ticketTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, name: renamed.body.name, active: false }),
    ]));

    await request(app.getHttpServer())
      .patch(`/api/v1/management/settings/ticket-types/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ active: true })
      .expect(200);

    const audit = await request(app.getHttpServer())
      .get("/api/v1/audit-events?action=ticket.type_updated&limit=2")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(audit.body.filter((event: { entityId: string }) => event.entityId === created.body.id)).toHaveLength(2);
  });

  it("replays concurrent price-group and admission-type creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const cases = [
      { path: "price-tiers", action: "ticket.price_tier_created", model: "priceTier", payload: { name: `Replay price ${crypto.randomUUID()}`, ticketPriceMinor: 1900 } },
      { path: "ticket-types", action: "ticket.type_created", model: "ticketType", payload: { name: `Replay admission ${crypto.randomUUID()}`, priceAdjustmentMinor: -200 } },
    ] as const;
    for (const entry of cases) {
      const requestId = crypto.randomUUID();
      const submit = () => request(app.getHttpServer()).post(`/api/v1/management/settings/${entry.path}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(entry.payload);
      const [first, replay] = await Promise.all([submit(), submit()]);
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(first.body.id).toBe(replay.body.id);
      expect(await prisma.auditEvent.count({ where: { action: entry.action, entityId: first.body.id } })).toBe(1);
      const client = prisma[entry.model] as unknown as { delete(input: object): Promise<unknown> };
      await client.delete({ where: { id: first.body.id } });
    }
  });

  it("replays a concurrent ticket price-group update once", async () => {
    const { prisma } = await import("@cinema/database");
    const created = await request(app.getHttpServer())
      .post("/api/v1/management/settings/price-tiers")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Update replay ${crypto.randomUUID()}`, ticketPriceMinor: 1800 })
      .expect(201);
    const requestId = crypto.randomUUID();
    const submit = () => request(app.getHttpServer())
      .patch(`/api/v1/management/settings/price-tiers/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ ticketPriceMinor: 1950 });
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.body).toEqual(replay.body);
    expect(first.body.ticketPriceMinor).toBe(1950);
    expect(await prisma.auditEvent.count({ where: { action: "ticket.price_tier_updated", entityId: created.body.id } })).toBe(1);
    await prisma.priceTier.delete({ where: { id: created.body.id } });
  });

  it("replays a concurrent admission-type update once", async () => {
    const { prisma } = await import("@cinema/database");
    const created = await request(app.getHttpServer())
      .post("/api/v1/management/settings/ticket-types")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Admission update replay ${crypto.randomUUID()}`, priceAdjustmentMinor: -100 })
      .expect(201);
    const requestId = crypto.randomUUID();
    const submit = () => request(app.getHttpServer())
      .patch(`/api/v1/management/settings/ticket-types/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", requestId)
      .send({ priceAdjustmentMinor: -150 });
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.body).toEqual(replay.body);
    expect(first.body.priceAdjustmentMinor).toBe(-150);
    expect(await prisma.auditEvent.count({ where: { action: "ticket.type_updated", entityId: created.body.id } })).toBe(1);
    await prisma.ticketType.delete({ where: { id: created.body.id } });
  });

  it("lets managers update and deactivate restaurant charge rules", async () => {
    const { prisma } = await import("@cinema/database");
    const tax = await request(app.getHttpServer())
      .post("/api/v1/management/settings/tax-rules")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Integration tax ${Date.now()}`, appliesTo: "FOOD", ratePermille: 90, active: true });
    expect(tax.status).toBe(201);

    const taxUpdateRequestId = crypto.randomUUID();
    const updateTax = () => request(app.getHttpServer())
      .patch(`/api/v1/management/settings/tax-rules/${tax.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", taxUpdateRequestId)
      .send({ ratePermille: 95, active: false });
    const [updatedTax, replayedTax] = await Promise.all([updateTax(), updateTax()]);
    expect(updatedTax.status).toBe(200);
    expect(replayedTax.status).toBe(200);
    expect(replayedTax.body).toEqual(updatedTax.body);
    expect(updatedTax.body).toEqual(expect.objectContaining({ ratePermille: 95, active: false }));
    expect(await prisma.auditEvent.count({ where: { action: "tax_rule.updated", entityId: tax.body.id } })).toBe(1);

    const serviceCharge = await request(app.getHttpServer())
      .post("/api/v1/management/settings/service-charge-rules")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ name: `Integration service ${Date.now()}`, appliesTo: "ALL", ratePermille: 180, autoApply: true, active: true });
    expect(serviceCharge.status).toBe(201);

    const serviceUpdateRequestId = crypto.randomUUID();
    const updateServiceCharge = () => request(app.getHttpServer())
      .patch(`/api/v1/management/settings/service-charge-rules/${serviceCharge.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", serviceUpdateRequestId)
      .send({ autoApply: false, active: false });
    const [updatedServiceCharge, replayedServiceCharge] = await Promise.all([updateServiceCharge(), updateServiceCharge()]);
    expect(updatedServiceCharge.status).toBe(200);
    expect(replayedServiceCharge.status).toBe(200);
    expect(replayedServiceCharge.body).toEqual(updatedServiceCharge.body);
    expect(updatedServiceCharge.body).toEqual(expect.objectContaining({ autoApply: false, active: false }));
    expect(await prisma.auditEvent.count({ where: { action: "service_charge_rule.updated", entityId: serviceCharge.body.id } })).toBe(1);

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

  it("replays concurrent tax and service-charge rule creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const cases = [
      { path: "tax-rules", action: "tax_rule.created", model: "taxRule", payload: { name: `Replay tax ${crypto.randomUUID()}`, appliesTo: "FOOD", ratePermille: 71, active: true } },
      { path: "service-charge-rules", action: "service_charge_rule.created", model: "serviceChargeRule", payload: { name: `Replay charge ${crypto.randomUUID()}`, appliesTo: "ALL", flatCents: 250, autoApply: true, active: true } },
    ] as const;
    for (const entry of cases) {
      const requestId = crypto.randomUUID();
      const submit = () => request(app.getHttpServer()).post(`/api/v1/management/settings/${entry.path}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(entry.payload);
      const [first, replay] = await Promise.all([submit(), submit()]);
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(first.body.id).toBe(replay.body.id);
      const client = prisma[entry.model] as unknown as { count(input: object): Promise<number>; delete(input: object): Promise<unknown> };
      expect(await client.count({ where: { locationId: owner.locationId, name: entry.payload.name } })).toBe(1);
      expect(await prisma.auditEvent.count({ where: { action: entry.action, entityId: first.body.id } })).toBe(1);
      await client.delete({ where: { id: first.body.id } });
    }
  });

  it("lets managers deactivate and reactivate promotions with an audit trail", async () => {
    const promotion = await request(app.getHttpServer())
      .post("/api/v1/management/settings/promotions")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ code: `LIFE${Date.now()}`, name: "Integration lifecycle", type: "PERCENTAGE", percentageBasisPoints: 1500, minimumSubtotalCents: 2500, maximumRedemptions: 20, active: true });
    expect(promotion.status).toBe(201);
    expect(promotion.body).toEqual(expect.objectContaining({ minimumSubtotalCents: 2500, maximumRedemptions: 20 }));

    const deactivateRequestId = crypto.randomUUID();
    const deactivate = () => request(app.getHttpServer())
      .patch(`/api/v1/management/settings/promotions/${promotion.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", deactivateRequestId)
      .send({ active: false });
    const [deactivated, replayedDeactivation] = await Promise.all([deactivate(), deactivate()]);
    expect(deactivated.status).toBe(200);
    expect(replayedDeactivation.body).toEqual(deactivated.body);
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

  it("replays concurrent promotion creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const requestId = crypto.randomUUID();
    const code = `REPLAY${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const payload = { code, name: "Replay promotion", type: "FIXED_AMOUNT", amountCents: 500, active: true };
    const submit = () => request(app.getHttpServer()).post("/api/v1/management/settings/promotions").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(payload);
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.promotion.count({ where: { code: code.toUpperCase() } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "promotion.created", entityId: first.body.id } })).toBe(1);
    await prisma.promotion.delete({ where: { id: first.body.id } });
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
        totalCents: 1223,
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
      expect.objectContaining({ redemptionCount: 1, discountedTicketCount: 1, totalTicketFaceValueCents: 2000, totalCollectedCents: 1223, totalDiscountCents: 777 }),
    );
  });

  it("issues organization gift cards with a one-time code and immutable opening ledger entry", async () => {
    const issuanceKey = crypto.randomUUID();
    const issued = await request(app.getHttpServer())
      .post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", issuanceKey)
      .send({ amountCents: 2500, recipientName: "Gift Recipient", recipientEmail: "GIFT@EXAMPLE.TEST" })
      .expect(201);

    expect(issued.body).toEqual(expect.objectContaining({ balanceCents: 2500, initialBalanceCents: 2500, codeLast4: expect.any(String), code: expect.stringMatching(/^ATGC-(?:[A-F0-9]{4}-){5}[A-F0-9]{4}$/) }));
    expect(issued.body).not.toHaveProperty("codeHash");
    const replay = await request(app.getHttpServer())
      .post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", issuanceKey)
      .send({ amountCents: 2500, recipientName: "Gift Recipient", recipientEmail: "GIFT@EXAMPLE.TEST" })
      .expect(201);
    expect(replay.body).toMatchObject({ id: issued.body.id, code: issued.body.code });

    const balance = await request(app.getHttpServer())
      .post("/api/v1/cinema/gift-cards/balance")
      .send({ code: issued.body.code.toLowerCase() })
      .expect(201);
    expect(balance.body).toEqual({ codeLast4: issued.body.codeLast4, balanceCents: 2500, currency: issued.body.currency });
    expect(balance.body).not.toHaveProperty("recipientEmail");

    const listed = await request(app.getHttpServer())
      .get("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    const card = listed.body.find((candidate: { id: string }) => candidate.id === issued.body.id);
    expect(card).toEqual(expect.objectContaining({ codeLast4: issued.body.codeLast4, balanceCents: 2500, recipientEmail: "gift@example.test" }));
    expect(card.transactions).toEqual([expect.objectContaining({ type: "ISSUANCE", amountCents: 2500, balanceAfterCents: 2500, location: expect.objectContaining({ name: expect.any(String) }), employee: expect.objectContaining({ name: expect.any(String) }) })]);
    expect(card).not.toHaveProperty("code");
    expect(card).not.toHaveProperty("codeHash");

    const { prisma } = await import("@cinema/database");
    expect(await prisma.giftCardTransaction.findMany({ where: { giftCardId: issued.body.id } })).toEqual([
      expect.objectContaining({ type: "ISSUANCE", amountCents: 2500, balanceAfterCents: 2500 }),
    ]);
    expect(await prisma.auditEvent.count({ where: { entityType: "GiftCard", entityId: issued.body.id, action: "gift_card.issued" } })).toBe(1);

    const deactivateRequestId = crypto.randomUUID();
    const deactivate = () => request(app.getHttpServer())
      .patch(`/api/v1/management/gift-cards/${issued.body.id}/status`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", deactivateRequestId)
      .send({ status: "DEACTIVATED" });
    const [deactivated, replayedDeactivation] = await Promise.all([deactivate(), deactivate()]);
    expect(deactivated.status).toBe(200);
    expect(replayedDeactivation.body).toEqual(deactivated.body);
    await request(app.getHttpServer()).post("/api/v1/cinema/gift-cards/balance").send({ code: issued.body.code }).expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/management/gift-cards/${issued.body.id}/status`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ status: "ACTIVE" })
      .expect(200);
    await request(app.getHttpServer()).post("/api/v1/cinema/gift-cards/balance").send({ code: issued.body.code }).expect(201);
    expect(await prisma.auditEvent.count({ where: { entityType: "GiftCard", entityId: issued.body.id, action: "gift_card.status_updated" } })).toBe(2);
  });

  it("issues a customer gift card exactly once after verified payment", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const config = await request(app.getHttpServer()).get(`/api/v1/gift-card-purchases/config?locationId=${owner.locationId}`).expect(200);
    expect(config.body).toMatchObject({ locationId: owner.locationId, currency: "USD", payment: { ready: false } });
    const idempotencyKey = `gift-card-purchase-${crypto.randomUUID()}`;
    const purchase = await request(app.getHttpServer()).post("/api/v1/gift-card-purchases")
      .set("Idempotency-Key", idempotencyKey).send({
        locationId: owner.locationId, amountCents: 3500, buyerEmail: "buyer@example.test",
        recipientName: "Movie Fan", recipientEmail: "recipient@example.test", message: "Enjoy the show!",
      }).expect(201);
    expect(purchase.body).toMatchObject({ amountCents: 3500, currency: "USD", recipientEmail: "recipient@example.test", payment: { providerPaymentId: expect.any(String), clientSecret: expect.any(String) } });
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    provider.setIntentStatus(purchase.body.payment.providerPaymentId, "SUCCEEDED");

    const finalized = await request(app.getHttpServer()).post(`/api/v1/gift-card-purchases/${purchase.body.purchaseId}/finalize`).send({}).expect(201);
    expect(finalized.body).toMatchObject({ status: "PAID", amountCents: 3500, code: expect.stringMatching(/^ATGC-/), codeLast4: expect.any(String), delivery: { status: "DELIVERED" } });
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const email = app.get(EMAIL_PROVIDER) as InstanceType<typeof TestEmailProvider>;
    expect(email.sentGiftCards).toEqual(expect.arrayContaining([expect.objectContaining({ to: "recipient@example.test", buyerEmail: "buyer@example.test", amountCents: 3500, code: finalized.body.code, message: "Enjoy the show!" })]));
    const replay = await request(app.getHttpServer()).post(`/api/v1/gift-card-purchases/${purchase.body.purchaseId}/finalize`).send({}).expect(201);
    expect(replay.body.code).toBeNull();
    expect(await prisma.giftCard.count({ where: { purchase: { id: purchase.body.purchaseId } } })).toBe(1);
    const storedPurchase = await prisma.giftCardPurchase.findUniqueOrThrow({ where: { id: purchase.body.purchaseId } });
    expect(storedPurchase).toMatchObject({ status: "DELIVERED", deliveryCodeEncrypted: null, deliveryClaimedAt: null, deliveryMessageId: expect.any(String), deliveredAt: expect.any(Date) });
    const sentCount = email.sentGiftCards.length;
    await request(app.getHttpServer()).post(`/api/v1/gift-card-purchases/${purchase.body.purchaseId}/delivery`).send({}).expect(201);
    expect(email.sentGiftCards).toHaveLength(sentCount);
    await request(app.getHttpServer()).post("/api/v1/cinema/gift-cards/balance").send({ code: finalized.body.code }).expect(201);
  });

  it("reuses one online gift card purchase when identical requests arrive concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    const originalCreate = provider.createPaymentIntent.bind(provider);
    const createIntent = jest.spyOn(provider, "createPaymentIntent").mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return originalCreate(input);
    });
    const idempotencyKey = `gift-card-purchase-race-${crypto.randomUUID()}`;
    const payload = {
      locationId: owner.locationId, amountCents: 4200, buyerEmail: "race-buyer@example.test",
      recipientName: "Concurrent Fan", recipientEmail: "race-recipient@example.test",
    };

    try {
      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post("/api/v1/gift-card-purchases").set("Idempotency-Key", idempotencyKey).send(payload),
        request(app.getHttpServer()).post("/api/v1/gift-card-purchases").set("Idempotency-Key", idempotencyKey).send(payload),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.purchaseId).toBe(first.body.purchaseId);
      expect(second.body.payment.providerPaymentId).toBe(first.body.payment.providerPaymentId);
      expect(first.body.payment.clientSecret).toEqual(expect.any(String));
      expect(second.body.payment.clientSecret).toEqual(expect.any(String));

      const purchases = await prisma.giftCardPurchase.findMany({ where: { idempotencyKey }, include: { payment: { include: { attempts: true } } } });
      expect(purchases).toHaveLength(1);
      expect(purchases[0].payment.attempts).toHaveLength(1);
      expect(createIntent).toHaveBeenCalled();

      await request(app.getHttpServer()).post("/api/v1/gift-card-purchases")
        .set("Idempotency-Key", idempotencyKey)
        .send({ ...payload, amountCents: payload.amountCents + 100 })
        .expect(409, {
          code: "CONFLICT",
          message: "The gift card purchase idempotency key was already used with different purchase details.",
        });
    } finally {
      createIntent.mockRestore();
    }
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

    const removalRequestId = crypto.randomUUID();
    const removeShowtime = () => request(app.getHttpServer())
      .delete(`/api/v1/cinema/showtimes/${showtime.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", removalRequestId);
    const [removed, replayedRemoval] = await Promise.all([
      removeShowtime(),
      removeShowtime(),
    ]);
    expect(removed.status).toBe(200);
    expect(replayedRemoval.status).toBe(200);
    expect(replayedRemoval.body).toEqual(removed.body);
    expect(await prisma.auditEvent.count({
      where: { action: "showtime.removed", entityId: showtime.body.id },
    })).toBe(1);
    const archiveRequestId = crypto.randomUUID();
    const archive = () => request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", archiveRequestId);
    const [archivedOnce, replayedArchive] = await Promise.all([
      archive(),
      archive(),
    ]);
    expect(archivedOnce.status).toBe(200);
    expect(replayedArchive.status).toBe(200);
    expect(replayedArchive.body.id).toBe(archivedOnce.body.id);
    expect(await prisma.auditEvent.count({
      where: { action: "movie.archived", entityId: movie.body.id },
    })).toBe(1);
    const deactivateRequestId = crypto.randomUUID();
    const deactivate = () => request(app.getHttpServer())
      .delete(`/api/v1/cinema/auditoriums/${auditorium.body.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", deactivateRequestId);
    const [deactivated, replayedDeactivation] = await Promise.all([
      deactivate(),
      deactivate(),
    ]);
    expect(deactivated.status).toBe(200);
    expect(replayedDeactivation.status).toBe(200);
    expect(replayedDeactivation.body.id).toBe(deactivated.body.id);
    expect(deactivated.body.active).toBe(false);
    expect(await prisma.auditEvent.count({
      where: { action: "auditorium.deactivated", entityId: auditorium.body.id },
    })).toBe(1);

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

    const requestId = crypto.randomUUID();
    const submitDuplicate = () =>
      request(app.getHttpServer())
        .post("/api/v1/cinema/showtimes/duplicate-day")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .set("Idempotency-Key", requestId)
        .send({
          sourceDate: "2031-02-10",
          targetDates: ["2031-02-12", "2031-02-13"],
          saleStatus: "ON_SALE",
        });
    const [duplicated, replayed] = await Promise.all([
      submitDuplicate(),
      submitDuplicate(),
    ]);

    expect(duplicated.status).toBe(201);
    expect(replayed.status).toBe(201);

    expect(duplicated.body.createdCount).toBe(2);
    expect(duplicated.body.showtimes).toHaveLength(2);
    expect(replayed.body.showtimes.map((showtime: { id: string }) => showtime.id)).toEqual(
      duplicated.body.showtimes.map((showtime: { id: string }) => showtime.id),
    );
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

    const { prisma } = await import("@cinema/database");
    const restoreRequestId = crypto.randomUUID();
    const restore = () => request(app.getHttpServer())
      .post(`/api/v1/cinema/movies/${movie.body.id}/restore`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", restoreRequestId);
    const [restoredOnce, replayedRestore] = await Promise.all([
      restore(),
      restore(),
    ]);
    expect(restoredOnce.status).toBe(201);
    expect(replayedRestore.status).toBe(201);
    expect(replayedRestore.body.id).toBe(restoredOnce.body.id);
    expect(await prisma.auditEvent.count({
      where: { action: "movie.restored", entityId: movie.body.id },
    })).toBe(1);

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

    const { prisma } = await import("@cinema/database");
    const deleteRequestId = crypto.randomUUID();
    const permanentlyDelete = () => request(app.getHttpServer())
      .delete(`/api/v1/cinema/movies/${movie.body.id}/permanent`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", deleteRequestId);
    const [deleted, replayedDelete] = await Promise.all([
      permanentlyDelete(),
      permanentlyDelete(),
    ]);
    expect(deleted.status).toBe(200);
    expect(replayedDelete.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, id: movie.body.id });
    expect(replayedDelete.body).toEqual(deleted.body);
    expect(await prisma.auditEvent.count({
      where: { action: "movie.deleted", entityId: movie.body.id },
    })).toBe(1);

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
    expect(res.body.showtime.timezone).toBe("America/Chicago");
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
    expect(config.body.baseTicketPriceCents).toBe(showtime.priceTier.ticketPriceMinor);
    const basePriceTicketType = config.body.ticketTypes.find(
      (ticketType: { priceAdjustmentMinor: number }) => ticketType.priceAdjustmentMinor === 0,
    );
    expect(basePriceTicketType).toBeDefined();
    const result = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: [holdToken],
        holderKey,
        ticketTypeId: basePriceTicketType.id,
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

  it("applies an active promotion code to online checkout", async () => {
    const { prisma } = await import("@cinema/database");
    const holderKey = `online-promotion-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const showtime = await prisma.showtime.findUniqueOrThrow({
      where: { id: showtimeId },
      select: { auditorium: { select: { locationId: true } }, priceTier: true },
    });
    const promotion = await prisma.promotion.create({ data: {
      locationId: showtime.auditorium.locationId,
      code: `ONLINE${Date.now()}`,
      name: "Online checkout promotion",
      type: "FIXED_AMOUNT",
      amountCents: 100,
    } });
    const config = await request(app.getHttpServer()).get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`).expect(200);

    const idempotencyKey = `checkout-${holderKey}`;
    const checkoutBody = {
      holdTokens: [hold.holdToken],
      holderKey,
      ticketTypeId: config.body.ticketTypes[0].id,
      email: `${holderKey}@example.test`,
      promotionCode: promotion.code.toLowerCase(),
      diningAuthorizationRequested: false,
    };
    const checkout = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", idempotencyKey)
      .send(checkoutBody)
      .expect(201);

    expect(checkout.body.discountCents).toBe(100);
    expect(checkout.body.promotion).toEqual({ code: promotion.code, name: promotion.name });
    expect(checkout.body.totalCents).toBe(showtime.priceTier.ticketPriceMinor - 100 + showtime.priceTier.feeMinor);
    const replay = await request(app.getHttpServer()).post("/api/v1/ticketing/checkouts").set("Idempotency-Key", idempotencyKey).send(checkoutBody).expect(201);
    expect(replay.body).toEqual(expect.objectContaining({ orderId: checkout.body.orderId, promotion: { code: promotion.code, name: promotion.name } }));
    expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.body.orderId } })).toMatchObject({ promotionId: promotion.id, discountCents: 100 });
  });

  it("applies and refunds a gift card during online checkout", async () => {
    const { prisma } = await import("@cinema/database");
    const holderKey = `online-gift-card-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const issued = await request(app.getHttpServer()).post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ amountCents: 500 }).expect(201);
    const config = await request(app.getHttpServer()).get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`).expect(200);
    const checkout = await request(app.getHttpServer()).post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`).send({
        holdTokens: [hold.holdToken], holderKey, ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`, giftCardCode: issued.body.code.toLowerCase(), diningAuthorizationRequested: false,
      }).expect(201);
    expect(checkout.body.giftCardCents).toBe(500);
    expect(checkout.body.payment.amountCents).toBe(checkout.body.totalCents - 500);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    provider.setIntentStatus(checkout.body.payment.providerPaymentId, "SUCCEEDED");
    await request(app.getHttpServer()).post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`).send({}).expect(201);
    expect((await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id } })).balanceCents).toBe(0);

    await request(app.getHttpServer()).post(`/api/v1/management/refunds/ticket-orders/${checkout.body.orderId}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), reason: "E2E online gift card refund" }).expect(201);
    expect((await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id } })).balanceCents).toBe(500);
  });

  it("completes an online ticket order entirely with a gift card", async () => {
    const { prisma } = await import("@cinema/database");
    const holderKey = `online-gift-card-only-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const issued = await request(app.getHttpServer()).post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ amountCents: 100_000 }).expect(201);
    const config = await request(app.getHttpServer()).get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`).expect(200);
    const checkout = await request(app.getHttpServer()).post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`).send({
        holdTokens: [hold.holdToken], holderKey, ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`, giftCardCode: issued.body.code, diningAuthorizationRequested: false,
      }).expect(201);
    expect(checkout.body.giftCardCents).toBe(checkout.body.totalCents);
    expect(checkout.body.payment).toBeNull();

    const finalized = await request(app.getHttpServer()).post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`).send({}).expect(201);
    expect(finalized.body.status).toBe("PAID");
    expect(finalized.body.tickets).toHaveLength(1);
    const giftCard = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id }, include: { transactions: { where: { type: "REDEMPTION" } } } });
    expect(giftCard.balanceCents).toBe(100_000 - checkout.body.totalCents);
    expect(giftCard.transactions).toEqual([expect.objectContaining({ amountCents: -checkout.body.totalCents, reference: checkout.body.orderId })]);
  });

  it("finalizes tickets and order-ahead food as one prepaid seat-linked purchase", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const holderKey = `online-order-ahead-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const config = await request(app.getHttpServer())
      .get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`)
      .expect(200);
    const menuItem = config.body.orderAhead.categories
      .flatMap((category: { items: Array<{
        id: string;
        modifierGroups: Array<{
          required: boolean;
          minSelections: number;
          modifiers: Array<{ id: string }>;
        }>;
      }> }) => category.items)
      .find(Boolean) as {
        id: string;
        modifierGroups: Array<{
          required: boolean;
          minSelections: number;
          modifiers: Array<{ id: string }>;
        }>;
      } | undefined;
    expect(menuItem).toBeDefined();
    const modifierIds = menuItem!.modifierGroups.flatMap((group) =>
      group.modifiers
        .slice(0, Math.max(group.required ? 1 : 0, group.minSelections))
        .map((modifier) => modifier.id),
    );

    const checkout = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: [hold.holdToken],
        holderKey,
        ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`,
        diningAuthorizationRequested: true,
        orderAhead: [{ menuItemId: menuItem!.id, quantity: 1, modifierIds }],
      })
      .expect(201);

    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    provider.setIntentStatus(checkout.body.payment.providerPaymentId, "SUCCEEDED");
    const finalized = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`)
      .send({})
      .expect(201);

    expect(finalized.body.status).toBe("PAID");
    expect(finalized.body.tickets).toHaveLength(1);
    const restaurantOrder = await prisma.restaurantOrder.findFirstOrThrow({
      where: { ticketOrderId: checkout.body.orderId },
      include: {
        items: true,
        fulfillmentTickets: true,
        restaurantTab: { include: { seats: true } },
      },
    });
    expect(restaurantOrder).toMatchObject({
      source: "ONLINE_ORDER_AHEAD",
      status: "SENT",
      restaurantTab: {
        prepaidCents:
          checkout.body.orderAheadSubtotalCents +
          checkout.body.orderAheadTaxCents +
          checkout.body.orderAheadServiceChargeCents,
        seats: [expect.objectContaining({ ticketId: finalized.body.tickets[0].id })],
      },
    });
    expect(restaurantOrder.items).toHaveLength(1);
    expect(restaurantOrder.fulfillmentTickets).toHaveLength(1);
  });

  it("redeems a gift-card-only checkout once when finalize requests race", async () => {
    const { prisma } = await import("@cinema/database");
    const holderKey = `online-gift-card-race-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const issued = await request(app.getHttpServer())
      .post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ amountCents: 100_000 })
      .expect(201);
    const config = await request(app.getHttpServer())
      .get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`)
      .expect(200);
    const checkout = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: [hold.holdToken],
        holderKey,
        ticketTypeId: config.body.ticketTypes[0].id,
        email: `${holderKey}@example.test`,
        giftCardCode: issued.body.code,
        diningAuthorizationRequested: false,
      })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`)
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`)
        .send({}),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.status).toBe("PAID");
    expect(second.body.status).toBe("PAID");
    expect(second.body.tickets[0].id).toBe(first.body.tickets[0].id);
    const giftCard = await prisma.giftCard.findUniqueOrThrow({
      where: { id: issued.body.id },
      include: {
        transactions: {
          where: { type: "REDEMPTION", reference: checkout.body.orderId },
        },
      },
    });
    expect(giftCard.balanceCents).toBe(100_000 - checkout.body.totalCents);
    expect(giftCard.transactions).toEqual([
      expect.objectContaining({ amountCents: -checkout.body.totalCents }),
    ]);
    expect(
      await prisma.ticket.count({
        where: { ticketOrderId: checkout.body.orderId },
      }),
    ).toBe(1);
  });

  it("recovers the same payment intent when checkout persistence fails after provider creation", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const holderKey = `checkout-intent-recovery-${crypto.randomUUID()}`;
    const idempotencyKey = `checkout-${holderKey}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const config = await request(app.getHttpServer())
      .get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`)
      .expect(200);
    const payload = {
      holdTokens: [hold.holdToken],
      holderKey,
      ticketTypeId: config.body.ticketTypes[0].id,
      email: `${holderKey}@example.test`,
      diningAuthorizationRequested: false,
    };
    const createIntent = jest.spyOn(provider, "createPaymentIntent");
    const persistIntent = jest
      .spyOn(prisma.ticketOrder, "update")
      .mockRejectedValueOnce(new Error("Database unavailable after provider creation"));

    await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", idempotencyKey)
      .send(payload)
      .expect(500);
    persistIntent.mockRestore();

    const recovered = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", idempotencyKey)
      .send(payload)
      .expect(201);

    expect(createIntent).toHaveBeenCalledTimes(2);
    await expect(createIntent.mock.results[0]?.value).resolves.toMatchObject({
      id: recovered.body.payment.providerPaymentId,
    });
    const orders = await prisma.ticketOrder.findMany({
      where: { checkoutIdempotencyKey: idempotencyKey },
      include: { payment: { include: { attempts: true } } },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.payment).toMatchObject({
      providerPaymentId: recovered.body.payment.providerPaymentId,
      attempts: [
        expect.objectContaining({
          attemptNumber: 1,
          providerIntentId: recovered.body.payment.providerPaymentId,
        }),
      ],
    });
    createIntent.mockRestore();
  });

  it("creates one order and payment attempt when identical checkout requests race", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const holderKey = `concurrent-checkout-${crypto.randomUUID()}`;
    const idempotencyKey = `checkout-${holderKey}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const config = await request(app.getHttpServer())
      .get(`/api/v1/ticketing/showtimes/${showtimeId}/checkout-config`)
      .expect(200);
    const payload = {
      holdTokens: [hold.holdToken],
      holderKey,
      ticketTypeId: config.body.ticketTypes[0].id,
      email: `${holderKey}@example.test`,
      diningAuthorizationRequested: false,
    };
    const originalCreateIntent = provider.createPaymentIntent.bind(provider);
    const createIntent = jest
      .spyOn(provider, "createPaymentIntent")
      .mockImplementation(async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return originalCreateIntent(args);
      });

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/ticketing/checkouts")
        .set("Idempotency-Key", idempotencyKey)
        .send(payload),
      request(app.getHttpServer())
        .post("/api/v1/ticketing/checkouts")
        .set("Idempotency-Key", idempotencyKey)
        .send(payload),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.orderId).toBe(first.body.orderId);
    expect(second.body.payment.providerPaymentId).toBe(
      first.body.payment.providerPaymentId,
    );
    expect(createIntent).toHaveBeenCalledTimes(2);
    const orders = await prisma.ticketOrder.findMany({
      where: { checkoutIdempotencyKey: idempotencyKey },
      include: { payment: { include: { attempts: true } } },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.payment?.attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        providerIntentId: first.body.payment.providerPaymentId,
      }),
    ]);

    await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", idempotencyKey)
      .send({ ...payload, email: `different-${payload.email}` })
      .expect(409, {
        code: "CONFLICT",
        message: "The checkout idempotency key was already used with different checkout details.",
        details: { reason: "CONFLICT" },
      });
    expect(createIntent).toHaveBeenCalledTimes(2);
    createIntent.mockRestore();
  });

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

  it("preserves a different admission type for each held seat", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const holderKey = `mixed-ticket-types-${crypto.randomUUID()}`;
    const availability = await request(app.getHttpServer())
      .get(`/api/v1/cinema/showtimes/${showtimeId}/seats`)
      .expect(200);
    const seats = availability.body.seats
      .filter((seat: { state: string }) => seat.state === "AVAILABLE")
      .slice(0, 2);
    expect(seats).toHaveLength(2);
    const holds = await request(app.getHttpServer())
      .post(`/api/v1/cinema/showtimes/${showtimeId}/holds`)
      .send({ seatIds: seats.map((seat: { id: string }) => seat.id), holderKey })
      .expect(201);
    const showtime = await prisma.showtime.findUniqueOrThrow({
      where: { id: showtimeId },
      select: { auditorium: { select: { locationId: true } }, priceTier: { select: { ticketPriceMinor: true } } },
    });
    const adult = await prisma.ticketType.findFirstOrThrow({
      where: { locationId: showtime.auditorium.locationId, active: true },
    });
    const child = await prisma.ticketType.create({
      data: {
        locationId: showtime.auditorium.locationId,
        name: `Child ${crypto.randomUUID()}`,
        priceAdjustmentMinor: -200,
      },
    });
    const ticketTypeSelections = [
      { holdToken: holds.body[0].holdToken, ticketTypeId: adult.id },
      { holdToken: holds.body[1].holdToken, ticketTypeId: child.id },
    ];
    const checkout = await request(app.getHttpServer())
      .post("/api/v1/ticketing/checkouts")
      .set("Idempotency-Key", `checkout-${holderKey}`)
      .send({
        holdTokens: ticketTypeSelections.map((selection) => selection.holdToken),
        holderKey,
        ticketTypeId: adult.id,
        ticketTypeSelections,
        email: `${holderKey}@example.test`,
        diningAuthorizationRequested: false,
      })
      .expect(201);
    expect(checkout.body.subtotalCents).toBe(
      Math.max(0, showtime.priceTier.ticketPriceMinor + adult.priceAdjustmentMinor) +
      Math.max(0, showtime.priceTier.ticketPriceMinor + child.priceAdjustmentMinor),
    );
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<typeof TestPaymentProvider>;
    provider.setIntentStatus(checkout.body.payment.providerPaymentId, "SUCCEEDED");
    const confirmation = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.body.orderId}/finalize`)
      .send({})
      .expect(201);
    expect(confirmation.body.tickets.map((ticket: { ticketType: string }) => ticket.ticketType).sort())
      .toEqual([adult.name, child.name].sort());

    const issued = await prisma.ticket.findMany({
      where: { ticketOrderId: checkout.body.orderId },
      select: { showtimeSeatId: true, ticketTypeId: true, priceCentsPaid: true },
    });
    const heldInventory = await prisma.seatHold.findMany({
      where: { holdToken: { in: ticketTypeSelections.map((selection) => selection.holdToken) } },
      select: { holdToken: true, showtimeSeatId: true },
    });
    for (const selection of ticketTypeSelections) {
      const inventoryId = heldInventory.find((hold) => hold.holdToken === selection.holdToken)!.showtimeSeatId;
      const ticketType = selection.ticketTypeId === adult.id ? adult : child;
      expect(issued).toContainEqual({ showtimeSeatId: inventoryId, ticketTypeId: selection.ticketTypeId, priceCentsPaid: Math.max(0, showtime.priceTier.ticketPriceMinor + ticketType.priceAdjustmentMinor) });
    }
  });

  it("still issues tickets when receipt email delivery is unavailable", async () => {
    const holderKey = `ticket-receipt-outage-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const { prisma } = await import("@cinema/database");
    const paymentProvider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    paymentProvider.setIntentStatus(
      checkout.payment.providerPaymentId,
      "SUCCEEDED",
    );
    const sendReceipt = jest
      .spyOn(emailProvider, "sendTicketReceipt")
      .mockRejectedValueOnce(new Error("Email provider unavailable"));

    const finalized = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({})
      .expect(201);

    expect(finalized.body).toMatchObject({
      status: "PAID",
      receiptDelivery: "FAILED",
      tickets: [expect.objectContaining({ issuanceToken: expect.any(String) })],
    });
    await expect(
      prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } }),
    ).resolves.toMatchObject({
      status: "PAID",
      receiptEmailSentAt: null,
      receiptEmailClaimedAt: null,
      receiptEmailError: "Email provider unavailable",
    });
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
    sendReceipt.mockRestore();
  });

  it("lets the checkout holder retry a failed guest receipt without issuing duplicate tickets", async () => {
    const holderKey = `ticket-receipt-retry-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const { prisma } = await import("@cinema/database");
    const paymentProvider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    paymentProvider.setIntentStatus(
      checkout.payment.providerPaymentId,
      "SUCCEEDED",
    );
    const sendReceipt = jest
      .spyOn(emailProvider, "sendTicketReceipt")
      .mockRejectedValueOnce(new Error("Email provider unavailable"));

    const failedDelivery = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/receipt`)
      .send({ holderKey: "wrong-holder-key-000000" })
      .expect(404);
    const recoveredDelivery = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/receipt`)
      .send({ holderKey })
      .expect(201);

    expect(failedDelivery.body.receiptDelivery).toBe("FAILED");
    expect(recoveredDelivery.body).toMatchObject({
      receiptDelivery: "SENT",
      email: expect.stringMatching(/^ticket-receipt-retry-.*@example\.test$/),
    });
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
    await expect(
      prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } }),
    ).resolves.toMatchObject({
      receiptEmailSentAt: expect.any(Date),
      receiptEmailClaimedAt: null,
      receiptEmailError: null,
    });
    sendReceipt.mockRestore();
  });

  it("claims ticket receipt delivery once when finalize requests race", async () => {
    const holderKey = `ticket-receipt-race-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const { prisma } = await import("@cinema/database");
    const paymentProvider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    paymentProvider.setIntentStatus(
      checkout.payment.providerPaymentId,
      "SUCCEEDED",
    );
    const sendReceipt = jest
      .spyOn(emailProvider, "sendTicketReceipt")
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { messageId: "test-concurrent-ticket-receipt" };
      });

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
        .send({}),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
    await expect(
      prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } }),
    ).resolves.toMatchObject({
      status: "PAID",
      receiptEmailSentAt: expect.any(Date),
      receiptEmailMessageId: "test-concurrent-ticket-receipt",
      receiptEmailClaimedAt: null,
    });
    sendReceipt.mockRestore();
  });

  it("reclaims a stale ticket receipt delivery without issuing duplicate tickets", async () => {
    const holderKey = `ticket-receipt-stale-claim-${crypto.randomUUID()}`;
    const { hold } = await holdAvailableSeat(holderKey);
    const checkout = await createCheckout(holderKey, hold.holdToken);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const { prisma } = await import("@cinema/database");
    const paymentProvider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    paymentProvider.setIntentStatus(
      checkout.payment.providerPaymentId,
      "SUCCEEDED",
    );
    await prisma.ticketOrder.update({
      where: { id: checkout.orderId },
      data: { receiptEmailClaimedAt: new Date() },
    });
    const sendReceipt = jest.spyOn(emailProvider, "sendTicketReceipt");

    const claimed = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({})
      .expect(201);
    expect(claimed.body.receiptDelivery).toBe("NOT_REQUESTED");
    expect(sendReceipt).not.toHaveBeenCalled();

    await prisma.ticketOrder.update({
      where: { id: checkout.orderId },
      data: { receiptEmailClaimedAt: new Date(Date.now() - 6 * 60_000) },
    });
    const recovered = await request(app.getHttpServer())
      .post(`/api/v1/ticketing/orders/${checkout.orderId}/finalize`)
      .send({})
      .expect(201);

    expect(recovered.body.receiptDelivery).toBe("SENT");
    expect(sendReceipt).toHaveBeenCalledTimes(1);
    expect(
      await prisma.ticket.count({ where: { ticketOrderId: checkout.orderId } }),
    ).toBe(1);
    await expect(
      prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } }),
    ).resolves.toMatchObject({
      status: "PAID",
      receiptEmailSentAt: expect.any(Date),
      receiptEmailClaimedAt: null,
      receiptEmailError: null,
    });
    sendReceipt.mockRestore();
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
  let customerId: string;
  let accessCookie: string;
  let refreshCookie: string;

  it("registers a new customer account and stores tokens only in HttpOnly cookies", async () => {
    const requestId = crypto.randomUUID();
    const body = { email, password: "customer-password-1", name: "New Customer" };
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", requestId)
      .send(body);

    expect(res.status).toBe(201);
    customerId = res.body.customer.id;
    expect(res.body.customer.isGuest).toBe(false);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookies = setCookieHeaders(res);
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^attend_customer_access=.*HttpOnly.*SameSite=Lax/),
      expect.stringMatching(/^attend_customer_refresh=.*HttpOnly.*SameSite=Lax/),
    ]));

    const replay = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", requestId)
      .send(body);

    expect(replay.status).toBe(201);
    expect(replay.body.customer.id).toBe(customerId);
    expect(setCookieHeaders(replay)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^attend_customer_access=.*HttpOnly.*SameSite=Lax/),
      expect.stringMatching(/^attend_customer_refresh=.*HttpOnly.*SameSite=Lax/),
    ]));
    const { prisma } = await import("@cinema/database");
    const registrationAudits = await prisma.auditEvent.findMany({
      where: { action: "customer.registered", entityId: customerId },
    });
    expect(registrationAudits).toHaveLength(1);
    expect(registrationAudits[0]?.afterState).toMatchObject({ requestId });
  });

  it("rejects registering the same email twice (409 conflict)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/register")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", crypto.randomUUID())
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
      .set("Idempotency-Key", crypto.randomUUID())
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

  it("lets a signed-in customer update their profile name", async () => {
    const { prisma } = await import("@cinema/database");
    const invalid = await request(app.getHttpServer())
      .patch("/api/v1/auth/customers/me")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ name: "   " });
    expect(invalid.status).toBe(400);

    const requestId = crypto.randomUUID();
    const updated = await request(app.getHttpServer())
      .patch("/api/v1/auth/customers/me")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", requestId)
      .send({ name: "  Updated Customer  " });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ email, name: "Updated Customer", isGuest: false });
    await request(app.getHttpServer())
      .patch("/api/v1/auth/customers/me")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", requestId)
      .send({ name: "Updated Customer" })
      .expect(200);
    expect(await prisma.auditEvent.count({
      where: { action: "customer.profile_updated", afterState: { path: ["requestId"], equals: requestId } },
    })).toBe(1);

    const account = await request(app.getHttpServer())
      .get("/api/v1/auth/customers/me")
      .set("Cookie", accessCookie)
      .expect(200);
    expect(account.body.customer.name).toBe("Updated Customer");
  });

  it("lets a customer resend only their own paid ticket order to their account email", async () => {
    const { prisma } = await import("@cinema/database");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<typeof TestEmailProvider>;
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { tickets: { none: {} } },
      include: {
        showtime: {
          include: { auditorium: { include: { location: { include: { ticketTypes: true } } } } },
        },
      },
    });
    const ticketType = inventory.showtime.auditorium.location.ticketTypes[0]!;
    const order = await prisma.ticketOrder.create({
      data: {
        locationId: inventory.showtime.auditorium.location.id,
        customerId,
        ticketTypeId: ticketType.id,
        holdTokens: [],
        holderKey: crypto.randomUUID(),
        status: "PAID",
        orderNumber: `CUSTOMER-RECEIPT-${crypto.randomUUID()}`,
        checkoutIdempotencyKey: crypto.randomUUID(),
        subtotalCents: 1700,
        feesCents: 0,
        taxCents: 0,
        totalCents: 1700,
        tickets: {
          create: {
            showtimeSeatId: inventory.id,
            ticketTypeId: ticketType.id,
            priceCentsPaid: 1700,
            qrToken: `customer-receipt-${crypto.randomUUID()}`,
          },
        },
      },
    });

    const receiptRequestId = crypto.randomUUID();
    const receiptsBefore = emailProvider.sent.length;
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/auth/customers/orders/${order.id}/receipt`)
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", receiptRequestId)
      .send();
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ receiptDelivery: "SENT", email });
    await request(app.getHttpServer())
      .post(`/api/v1/auth/customers/orders/${order.id}/receipt`)
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", receiptRequestId)
      .send()
      .expect(200);
    expect(emailProvider.sent).toHaveLength(receiptsBefore + 1);

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/auth/customers/orders/${crypto.randomUUID()}/receipt`)
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send();
    expect(blocked.status).toBe(404);
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

  it("changes a customer password, rotates cookies, and invalidates the prior refresh session", async () => {
    const { prisma } = await import("@cinema/database");
    const incorrect = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/change-password")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ currentPassword: "wrong-password", newPassword: "customer-password-2" });
    expect(incorrect.status).toBe(401);

    const priorRefreshCookie = refreshCookie;
    const priorAccessCookie = accessCookie;
    const requestId = crypto.randomUUID();
    const changed = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/change-password")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", requestId)
      .send({ currentPassword: "customer-password-1", newPassword: "customer-password-2" });
    expect(changed.status).toBe(200);
    expect(changed.body.customer.email).toBe(email);
    const replay = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/change-password")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", priorAccessCookie)
      .set("Idempotency-Key", requestId)
      .send({ currentPassword: "customer-password-1", newPassword: "customer-password-2" })
      .expect(200);
    expect(await prisma.auditEvent.count({
      where: { action: "customer.password_changed", afterState: { path: ["requestId"], equals: requestId } },
    })).toBe(1);
    const cookies = setCookieHeaders(replay);
    accessCookie = cookiePair(cookies, "attend_customer_access");
    refreshCookie = cookiePair(cookies, "attend_customer_refresh");

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/refresh")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", priorRefreshCookie)
      .send()
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-1" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-2" })
      .expect(200);
  });

  it("recovers a customer password without revealing whether an email is registered", async () => {
    const { prisma } = await import("@cinema/database");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<typeof TestEmailProvider>;
    const deliveriesBefore = emailProvider.sentCustomerPasswordResets.length;

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/password-reset/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ email: "unknown-customer@m0test.local" })
      .expect(202, { accepted: true });
    expect(emailProvider.sentCustomerPasswordResets).toHaveLength(deliveriesBefore);

    const resetRequestId = crypto.randomUUID();
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/password-reset/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", resetRequestId)
      .send({ email: email.toUpperCase() })
      .expect(202, { accepted: true });
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/password-reset/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", resetRequestId)
      .send({ email: email.toUpperCase() })
      .expect(202, { accepted: true });
    expect(emailProvider.sentCustomerPasswordResets).toHaveLength(deliveriesBefore + 1);
    expect(await prisma.auditEvent.count({
      where: { action: "customer.password_reset_requested", afterState: { path: ["requestId"], equals: resetRequestId } },
    })).toBe(1);
    const delivery = emailProvider.sentCustomerPasswordResets.at(-1)!;
    const token = new URL(delivery.resetUrl).hash.replace("#resetPassword=", "");
    const requestId = crypto.randomUUID();

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/password-reset/confirm")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", requestId)
      .send({ token, newPassword: "customer-password-3" })
      .expect(200, { reset: true });
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/password-reset/confirm")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", requestId)
      .send({ token, newPassword: "customer-password-3" })
      .expect(200, { reset: true });
    expect(await prisma.auditEvent.count({
      where: { action: "customer.password_reset", afterState: { path: ["requestId"], equals: requestId } },
    })).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-2" })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-3" })
      .expect(200);
    const cookies = setCookieHeaders(login);
    accessCookie = cookiePair(cookies, "attend_customer_access");
    refreshCookie = cookiePair(cookies, "attend_customer_refresh");
  });

  it("changes a customer email only after the new address is verified", async () => {
    const { prisma } = await import("@cinema/database");
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<typeof TestEmailProvider>;
    const newEmail = "updated-customer@m0test.local";
    const requestId = crypto.randomUUID();

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/email-change/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ newEmail, password: "wrong-password" })
      .expect(401);

    const deliveriesBefore = emailProvider.sentCustomerEmailChanges.length;
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/email-change/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", requestId)
      .send({ newEmail: newEmail.toUpperCase(), password: "customer-password-3" })
      .expect(202, { accepted: true });
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/email-change/request")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", accessCookie)
      .set("Idempotency-Key", requestId)
      .send({ newEmail, password: "customer-password-3" })
      .expect(202, { accepted: true });
    expect(emailProvider.sentCustomerEmailChanges).toHaveLength(deliveriesBefore + 1);
    const delivery = emailProvider.sentCustomerEmailChanges.at(-1)!;
    expect(delivery.to).toBe(newEmail);
    const token = new URL(delivery.verificationUrl).hash.replace("#emailChange=", "");
    const confirmationRequestId = crypto.randomUUID();

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/email-change/confirm")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", confirmationRequestId)
      .send({ token })
      .expect(200, { changed: true });
    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/email-change/confirm")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Idempotency-Key", confirmationRequestId)
      .send({ token })
      .expect(200, { changed: true });
    expect(await prisma.auditEvent.count({
      where: { action: "customer.email_changed", afterState: { path: ["requestId"], equals: confirmationRequestId } },
    })).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email, password: "customer-password-3" })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/login")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .send({ email: newEmail, password: "customer-password-3" })
      .expect(200);
    const cookies = setCookieHeaders(login);
    accessCookie = cookiePair(cookies, "attend_customer_access");
    refreshCookie = cookiePair(cookies, "attend_customer_refresh");
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

    const replay = await request(app.getHttpServer())
      .post("/api/v1/auth/customers/logout")
      .set("Origin", CUSTOMER_WEB_ORIGIN)
      .set("Cookie", `${accessCookie}; ${refreshCookie}`)
      .send();
    expect(replay.status).toBe(204);
    expect(setCookieHeaders(replay)).toEqual(expect.arrayContaining([
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
    const { signTokenPair, Permission } = await import("@cinema/auth");
    const location = await prisma.location.findFirstOrThrow();
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
    const requestId = crypto.randomUUID();
    const splitRequest = () =>
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${sharedTabId}/split`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId, showtimeSeatId });
    const splits = await Promise.all([splitRequest(), splitRequest()]);
    expect(splits.map((response) => response.status)).toEqual([201, 201]);
    expect(splits[1].body.targetTabId).toBe(splits[0].body.targetTabId);
    const split = splits[0];

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

  it("never splits a seat from a tab after settlement closes it", async () => {
    const { prisma } = await import("@cinema/database");
    const orderId = await purchaseSeats("m5-split-settlement-race", 2, true);
    const opened = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/seat-linked")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ticketOrderId: orderId, mode: "SHARED" })
      .expect(201);
    const tabId = opened.body[0].id as string;
    const showtimeSeatId = opened.body[0].seats[0].showtimeSeatId as string;
    await prisma.restaurantTab.update({
      where: { id: tabId },
      data: { checkDroppedAt: new Date() },
    });

    const [finalized, split] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${tabId}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_split_race" },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${tabId}/split`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ showtimeSeatId }),
    ]);

    expect([
      [201, 201],
      [201, 404],
    ]).toContainEqual([finalized.status, split.status]);
    const finalSource = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: tabId },
      include: { seats: true },
    });
    expect(finalSource.status).toBe("CLOSED");
    expect(finalSource.seats).toHaveLength(split.status === 201 ? 1 : 2);
    if (split.status === 201) {
      const finalTarget = await prisma.restaurantTab.findUniqueOrThrow({
        where: { id: split.body.targetTabId },
        include: { seats: true },
      });
      expect(finalTarget).toMatchObject({ status: "OPEN", autoSettleAuthorized: false });
      expect(finalTarget.seats).toEqual([
        expect.objectContaining({ showtimeSeatId }),
      ]);
    }
  });

  it("never combines a tab into another tab after settlement closes it", async () => {
    const { prisma } = await import("@cinema/database");
    const target = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine settlement target" })
      .expect(201);
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine settlement source" })
      .expect(201);
    await prisma.restaurantTab.update({
      where: { id: target.body.id },
      data: { checkDroppedAt: new Date() },
    });

    const [finalized, combined] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${target.body.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_combine_race" },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${target.body.id}/combine`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ sourceTabId: source.body.id }),
    ]);

    expect([
      [201, 201],
      [201, 404],
    ]).toContainEqual([finalized.status, combined.status]);
    const [finalTarget, finalSource] = await Promise.all([
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: target.body.id } }),
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: source.body.id } }),
    ]);
    expect(finalTarget.status).toBe("CLOSED");
    expect(finalSource.status).toBe(combined.status === 201 ? "VOIDED" : "OPEN");
  });

  it("replays concurrent combines without applying the move twice", async () => {
    const target = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine replay target" })
      .expect(201);
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine replay source" })
      .expect(201);
    const requestId = crypto.randomUUID();
    const combine = () =>
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${target.body.id}/combine`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId, sourceTabId: source.body.id });

    const responses = await Promise.all([combine(), combine()]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[1].body).toEqual(responses[0].body);
    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: source.body.id } }),
    ).toMatchObject({ status: "VOIDED", mergedIntoTabId: target.body.id });
  });

  it("never combines a source tab away after settlement closes it", async () => {
    const { prisma } = await import("@cinema/database");
    const target = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine source race target" })
      .expect(201);
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Combine source race source" })
      .expect(201);
    await prisma.restaurantTab.update({
      where: { id: source.body.id },
      data: { checkDroppedAt: new Date() },
    });

    const [finalized, combined] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${source.body.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            {
              type: "CARD_PRESENT",
              amountCents: 1,
              readerId: "tmr_combine_source_race",
            },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${target.body.id}/combine`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ sourceTabId: source.body.id }),
    ]);

    expect([
      [201, 404],
      [409, 201],
    ]).toContainEqual([finalized.status, combined.status]);
    const [finalTarget, finalSource] = await Promise.all([
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: target.body.id } }),
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: source.body.id } }),
    ]);
    expect(finalTarget.status).toBe("OPEN");
    expect(finalSource.status).toBe(finalized.status === 201 ? "CLOSED" : "VOIDED");
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
  it("replays concurrent menu category and kitchen station creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const categoryRequestId = crypto.randomUUID();
    const categoryName = `Replay category ${crypto.randomUUID()}`;
    const submitCategory = () => request(app.getHttpServer()).post("/api/v1/restaurant-menu/categories").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", categoryRequestId).send({ name: categoryName, sortOrder: 99 });
    const [categoryFirst, categoryReplay] = await Promise.all([submitCategory(), submitCategory()]);
    expect(categoryFirst.status).toBe(201);
    expect(categoryReplay.body.id).toBe(categoryFirst.body.id);
    expect(await prisma.menuCategory.count({ where: { name: categoryName } })).toBe(1);

    const updateRequestId = crypto.randomUUID();
    const updatedName = `${categoryName} updated`;
    const updateCategory = () => request(app.getHttpServer()).patch(`/api/v1/restaurant-menu/categories/${categoryFirst.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", updateRequestId).send({ name: updatedName });
    const [categoryUpdated, categoryUpdateReplay] = await Promise.all([updateCategory(), updateCategory()]);
    expect(categoryUpdated.status).toBe(200);
    expect(categoryUpdateReplay.body).toEqual(categoryUpdated.body);
    expect(categoryUpdated.body.name).toBe(updatedName);
    expect(await prisma.auditEvent.count({ where: { action: "menu_category.updated", afterState: { path: ["requestId"], equals: updateRequestId } } })).toBe(1);

    const stationRequestId = crypto.randomUUID();
    const stationName = `Replay station ${crypto.randomUUID()}`;
    const submitStation = () => request(app.getHttpServer()).post("/api/v1/restaurant-menu/stations").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", stationRequestId).send({ name: stationName, displayType: "KITCHEN" });
    const [stationFirst, stationReplay] = await Promise.all([submitStation(), submitStation()]);
    expect(stationFirst.status).toBe(201);
    expect(stationReplay.body.id).toBe(stationFirst.body.id);
    expect(await prisma.kitchenStation.count({ where: { name: stationName } })).toBe(1);

    const stationUpdateRequestId = crypto.randomUUID();
    const updatedStationName = `${stationName} updated`;
    const updateStation = () => request(app.getHttpServer()).patch(`/api/v1/restaurant-menu/stations/${stationFirst.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", stationUpdateRequestId).send({ name: updatedStationName });
    const [stationUpdated, stationUpdateReplay] = await Promise.all([updateStation(), updateStation()]);
    expect(stationUpdated.status).toBe(200);
    expect(stationUpdateReplay.body).toEqual(stationUpdated.body);
    expect(stationUpdated.body.name).toBe(updatedStationName);
    expect(await prisma.auditEvent.count({ where: { action: "kitchen_station.updated", afterState: { path: ["requestId"], equals: stationUpdateRequestId } } })).toBe(1);
    await prisma.menuCategory.delete({ where: { id: categoryFirst.body.id } });
    await prisma.kitchenStation.delete({ where: { id: stationFirst.body.id } });
  });

  it("replays concurrent menu item creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const category = await prisma.menuCategory.findFirstOrThrow({ include: { location: true } });
    const station = await prisma.kitchenStation.findFirstOrThrow({ where: { locationId: category.locationId } });
    const requestId = crypto.randomUUID();
    const name = `Replay menu item ${crypto.randomUUID()}`;
    const payload = { menuCategoryId: category.id, kitchenStationId: station.id, name, priceCents: 875, chargeCategory: "FOOD", isVegan: false, isGlutenFree: false, sortOrder: 99 };
    const submit = () => request(app.getHttpServer()).post("/api/v1/restaurant-menu/items").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(payload);
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body.id).toBe(replay.body.id);
    expect(await prisma.menuItem.count({ where: { name } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "menu_item.created", entityId: first.body.id } })).toBe(1);

    const updateRequestId = crypto.randomUUID();
    const updatedName = `${name} updated`;
    const update = () => request(app.getHttpServer()).patch(`/api/v1/restaurant-menu/items/${first.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", updateRequestId).send({ name: updatedName });
    const [updated, updateReplay] = await Promise.all([update(), update()]);
    expect(updated.status).toBe(200);
    expect(updateReplay.body).toEqual(updated.body);
    expect(updated.body.name).toBe(updatedName);
    expect(await prisma.auditEvent.count({ where: { action: "menu_item.updated", afterState: { path: ["requestId"], equals: updateRequestId } } })).toBe(1);
    await prisma.menuItem.delete({ where: { id: first.body.id } });
  });

  it("replays concurrent modifier group and modifier creation once", async () => {
    const { prisma } = await import("@cinema/database");
    const item = await prisma.menuItem.findFirstOrThrow();
    const groupRequestId = crypto.randomUUID();
    const groupName = `Replay group ${crypto.randomUUID()}`;
    const submitGroup = () => request(app.getHttpServer()).post(`/api/v1/restaurant-menu/items/${item.id}/modifier-groups`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", groupRequestId).send({ name: groupName, selectionType: "SINGLE", required: false, minSelections: 0, maxSelections: 1, sortOrder: 99 });
    const [groupFirst, groupReplay] = await Promise.all([submitGroup(), submitGroup()]);
    expect(groupFirst.status).toBe(201);
    expect(groupReplay.body.id).toBe(groupFirst.body.id);
    expect(await prisma.modifierGroup.count({ where: { name: groupName } })).toBe(1);

    const groupUpdateRequestId = crypto.randomUUID();
    const updatedGroupName = `${groupName} updated`;
    const updateGroup = () => request(app.getHttpServer()).patch(`/api/v1/restaurant-menu/modifier-groups/${groupFirst.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", groupUpdateRequestId).send({ name: updatedGroupName });
    const [groupUpdated, groupUpdateReplay] = await Promise.all([updateGroup(), updateGroup()]);
    expect(groupUpdated.status).toBe(200);
    expect(groupUpdateReplay.body).toEqual(groupUpdated.body);
    expect(groupUpdated.body.name).toBe(updatedGroupName);
    expect(await prisma.auditEvent.count({ where: { action: "modifier_group.updated", afterState: { path: ["requestId"], equals: groupUpdateRequestId } } })).toBe(1);

    const modifierRequestId = crypto.randomUUID();
    const modifierName = `Replay modifier ${crypto.randomUUID()}`;
    const submitModifier = () => request(app.getHttpServer()).post(`/api/v1/restaurant-menu/modifier-groups/${groupFirst.body.id}/modifiers`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", modifierRequestId).send({ name: modifierName, priceDeltaCents: 125, sortOrder: 0 });
    const [modifierFirst, modifierReplay] = await Promise.all([submitModifier(), submitModifier()]);
    expect(modifierFirst.status).toBe(201);
    expect(modifierReplay.body.id).toBe(modifierFirst.body.id);
    expect(await prisma.modifier.count({ where: { name: modifierName } })).toBe(1);

    const modifierUpdateRequestId = crypto.randomUUID();
    const updatedModifierName = `${modifierName} updated`;
    const updateModifier = () => request(app.getHttpServer()).patch(`/api/v1/restaurant-menu/modifiers/${modifierFirst.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", modifierUpdateRequestId).send({ name: updatedModifierName });
    const [modifierUpdated, modifierUpdateReplay] = await Promise.all([updateModifier(), updateModifier()]);
    expect(modifierUpdated.status).toBe(200);
    expect(modifierUpdateReplay.body).toEqual(modifierUpdated.body);
    expect(modifierUpdated.body.name).toBe(updatedModifierName);
    expect(await prisma.auditEvent.count({ where: { action: "modifier.updated", afterState: { path: ["requestId"], equals: modifierUpdateRequestId } } })).toBe(1);
    await prisma.modifier.delete({ where: { id: modifierFirst.body.id } });
    await prisma.modifierGroup.delete({ where: { id: groupFirst.body.id } });
  });

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

    const tabRequestId = crypto.randomUUID();
    const openTab = () =>
      request(app.getHttpServer())
        .post("/api/v1/restaurant-tabs/walk-in")
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId: tabRequestId, label: "Bar guest 12" });
    const [tab, tabReplay] = await Promise.all([openTab(), openTab()]);
    expect(tab.status).toBe(201);
    expect(tabReplay.status).toBe(201);
    expect(tabReplay.body.id).toBe(tab.body.id);
    expect(tab.body).toMatchObject({
      tabType: "WALK_IN",
      label: "Bar guest 12",
      showtimeId: null,
      autoSettleAuthorized: false,
    });
    await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ requestId: tabRequestId, label: "Different guest" })
      .expect(409);

    const orderRequestId = crypto.randomUUID();
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ requestId: orderRequestId });
    expect(order.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ requestId: orderRequestId })
      .expect(201)
      .expect(({ body }) => expect(body.id).toBe(order.body.id));
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ requestId: orderRequestId, showtimeSeatId: crypto.randomUUID() })
      .expect(409);
    let burgerRequest: { requestId: string; body: Record<string, unknown>; itemId: string } | null = null;
    for (const item of [burger, cocktail]) {
      const modifierIds = item.modifierGroups
        .filter((group) => group.required)
        .map((group) => group.modifiers[0]!.id);
      const requestId = crypto.randomUUID();
      const body = { requestId, menuItemId: item.id, quantity: 1, modifierIds };
      const added = await request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send(body);
      expect(added.status).toBe(201);
      if (item.id === burger.id) {
        burgerRequest = { requestId, body, itemId: added.body.id };
      }
    }
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send(burgerRequest!.body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(burgerRequest!.itemId);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        ...burgerRequest!.body,
        menuItemId: cocktail.id,
      })
      .expect(409);
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

  it("never removes a draft line after its order is sent concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Send remove race" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    const item = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] });

    const [sent, removed] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({}),
      request(app.getHttpServer())
        .delete(`/api/v1/restaurant-tabs/orders/${order.body.id}/items/${item.body.id}`)
        .set("Authorization", `Bearer ${ownerAccessToken}`),
    ]);

    expect([
      [201, 404],
      [400, 200],
    ]).toContainEqual([sent.status, removed.status]);
    const finalOrder = await prisma.restaurantOrder.findUniqueOrThrow({
      where: { id: order.body.id },
      include: { items: true },
    });
    if (finalOrder.status === "SENT") {
      expect(finalOrder.items).toEqual([
        expect.objectContaining({ id: item.body.id, status: "SENT" }),
      ]);
    } else {
      expect(finalOrder).toMatchObject({ status: "DRAFT", placedAt: null });
      expect(finalOrder.items).toHaveLength(0);
    }
  });

  it("replays concurrent send-order requests without duplicating kitchen tickets", async () => {
    const { prisma } = await import("@cinema/database");
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Send replay" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] })
      .expect(201);

    const requestId = crypto.randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId });
    const responses = await Promise.all([send(), send()]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[1].body.fulfillmentTickets[0].id).toBe(
      responses[0].body.fulfillmentTickets[0].id,
    );
    expect(
      await prisma.fulfillmentTicket.count({
        where: { restaurantOrderId: order.body.id },
      }),
    ).toBe(1);
  });

  it("never adds a draft line after its order is sent concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Send add race" });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] })
      .expect(201);

    const [sent, added] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({}),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] }),
    ]);

    expect([
      [201, 404],
      [201, 201],
    ]).toContainEqual([sent.status, added.status]);
    const finalOrder = await prisma.restaurantOrder.findUniqueOrThrow({
      where: { id: order.body.id },
      include: { items: true },
    });
    if (added.status === 404) {
      expect(finalOrder).toMatchObject({ status: "SENT" });
      expect(finalOrder.items).toHaveLength(1);
      expect(finalOrder.items.every((item) => item.status === "SENT")).toBe(true);
    } else {
      expect(finalOrder).toMatchObject({ status: "SENT" });
      expect(finalOrder.items).toHaveLength(2);
      expect(finalOrder.items.every((item) => item.status === "SENT")).toBe(true);
    }
  });

  it("never sends a draft order after its tab settles concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Settle send race" })
      .expect(201);
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/items`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ menuItemId: cocktail.id, quantity: 1, modifierIds: [] })
      .expect(201);
    await prisma.restaurantTab.update({
      where: { id: tab.body.id },
      data: { status: "READY_TO_CLOSE", checkDroppedAt: new Date() },
    });

    const [finalized, sent] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${tab.body.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_send_race" },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/send`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({}),
    ]);

    expect([
      [201, 201],
      [400, 201],
      [409, 201],
    ]).toContainEqual([finalized.status, sent.status]);
    const [finalTab, finalOrder] = await Promise.all([
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.body.id } }),
      prisma.restaurantOrder.findUniqueOrThrow({ where: { id: order.body.id } }),
    ]);
    expect(finalOrder.status).toBe("SENT");
    expect(finalTab.status).toBe(finalized.status === 201 ? "CLOSED" : "READY_TO_CLOSE");
  });

  it("never creates a draft order after its tab is settled concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const tab = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Settle create race" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${tab.body.id}/drop-check`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);

    const [finalized, created] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${tab.body.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [{ type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_race" }],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/${tab.body.id}/orders`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({}),
    ]);

    expect([
      [201, 404],
      [409, 201],
    ]).toContainEqual([finalized.status, created.status]);
    const finalTab = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: tab.body.id },
      include: { orders: true },
    });
    if (finalized.status === 201) {
      expect(finalTab).toMatchObject({ status: "CLOSED" });
      expect(finalTab.orders).toHaveLength(0);
    } else {
      expect(finalTab).toMatchObject({ status: "READY_TO_CLOSE" });
      expect(finalTab.orders).toEqual([
        expect.objectContaining({ id: created.body.id, status: "DRAFT" }),
      ]);
    }
  });

  it("replays simultaneous customer tip updates with one audit event", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: { locationId: true, primaryCustomerId: true },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Tip replay",
        status: "OPEN",
      },
    });
    const access = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${tab.id}/access-link`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);
    const requestId = crypto.randomUUID();
    const tips = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/public/restaurant-tabs/${access.body.token}/tip`)
        .send({ requestId, tipCents: 250 }),
      request(app.getHttpServer())
        .post(`/api/v1/public/restaurant-tabs/${access.body.token}/tip`)
        .send({ requestId, tipCents: 250 }),
    ]);
    expect(tips.map((tip) => tip.status)).toEqual([201, 201]);
    expect(
      await prisma.auditEvent.count({
        where: { action: "restaurant_tab.tip_selected", entityId: tab.id },
      }),
    ).toBe(1);
  });

  it("never changes a selected tip after its tab is settled concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: { locationId: true, primaryCustomerId: true },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Settle tip race",
        status: "READY_TO_CLOSE",
        checkDroppedAt: new Date(),
      },
    });
    const access = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${tab.id}/access-link`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);

    const [finalized, tipped] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${tab.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [{ type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_tip_race" }],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/public/restaurant-tabs/${access.body.token}/tip`)
        .send({ tipCents: 250 }),
    ]);

    expect([
      [201, 404],
      [201, 201],
      [400, 200],
    ]).toContainEqual([finalized.status, tipped.status]);
    const finalTab = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: tab.id },
      include: { receipt: true },
    });
    if (finalized.status === 201) {
      expect(finalTab).toMatchObject({ status: "CLOSED", selectedTipCents: 0 });
      expect(finalTab.receipt).toMatchObject({ tipCents: 0 });
    } else {
      expect(finalTab).toMatchObject({ status: "READY_TO_CLOSE", selectedTipCents: 250 });
      expect(finalTab.receipt).toBeNull();
    }
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
    const removeRequestId = crypto.randomUUID();
    const removals = await Promise.all([
      request(app.getHttpServer())
        .delete(
          `/api/v1/restaurant-tabs/orders/${rejected.id}/items/${rejected.items[0]!.id}`,
        )
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId: removeRequestId }),
      request(app.getHttpServer())
        .delete(
          `/api/v1/restaurant-tabs/orders/${rejected.id}/items/${rejected.items[0]!.id}`,
        )
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId: removeRequestId }),
    ]);
    expect(removals.map((removal) => removal.status)).toEqual([200, 200]);
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
    const requestId = crypto.randomUUID();
    const moves = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/transfer`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId, targetTabId: target.body.id }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/transfer`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ requestId, targetTabId: target.body.id }),
    ]);
    expect(moves.map((move) => move.status)).toEqual([201, 201]);
    expect(moves.every((move) => move.body.restaurantTabId === target.body.id)).toBe(true);

    const { prisma } = await import("@cinema/database");
    expect(
      await prisma.auditEvent.count({
        where: { action: "restaurant_order.transferred", entityId: order.body.id },
      }),
    ).toBe(1);
  });

  it("never transfers an order onto a tab after that tab settles concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Transfer settlement source" })
      .expect(201);
    const sourceTab = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: source.body.id },
      select: { locationId: true, primaryCustomerId: true },
    });
    const target = await prisma.restaurantTab.create({
      data: {
        locationId: sourceTab.locationId,
        primaryCustomerId: sourceTab.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Transfer settlement target",
        status: "READY_TO_CLOSE",
        checkDroppedAt: new Date(),
      },
    });
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${source.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);

    const [finalized, transferred] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${target.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_transfer_race" },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/transfer`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ targetTabId: target.id }),
    ]);

    expect([
      [201, 404],
      [400, 201],
    ]).toContainEqual([finalized.status, transferred.status]);
    const [finalTarget, finalOrder] = await Promise.all([
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: target.id } }),
      prisma.restaurantOrder.findUniqueOrThrow({ where: { id: order.body.id } }),
    ]);
    if (finalized.status === 201) {
      expect(finalTarget.status).toBe("CLOSED");
      expect(finalOrder.restaurantTabId).toBe(source.body.id);
    } else {
      expect(finalTarget.status).toBe("READY_TO_CLOSE");
      expect(finalOrder.restaurantTabId).toBe(target.id);
    }
  });

  it("never transfers an order off a tab after that tab settles concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Transfer settled source" })
      .expect(201);
    const target = await request(app.getHttpServer())
      .post("/api/v1/restaurant-tabs/walk-in")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ label: "Transfer settled target" })
      .expect(201);
    const order = await request(app.getHttpServer())
      .post(`/api/v1/restaurant-tabs/${source.body.id}/orders`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({})
      .expect(201);
    await prisma.restaurantOrder.update({
      where: { id: order.body.id },
      data: { status: "SENT", placedAt: new Date() },
    });
    await prisma.restaurantTab.update({
      where: { id: source.body.id },
      data: { status: "READY_TO_CLOSE", checkDroppedAt: new Date() },
    });

    const [finalized, transferred] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${source.body.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [
            {
              type: "CARD_PRESENT",
              amountCents: 1,
              readerId: "tmr_transfer_source_race",
            },
          ],
        }),
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/orders/${order.body.id}/transfer`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({ targetTabId: target.body.id }),
    ]);

    expect(finalized.status).toBe(201);
    expect([201, 404]).toContain(transferred.status);
    const [finalSource, finalOrder] = await Promise.all([
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: source.body.id } }),
      prisma.restaurantOrder.findUniqueOrThrow({ where: { id: order.body.id } }),
    ]);
    expect(finalSource.status).toBe("CLOSED");
    expect(finalOrder.restaurantTabId).toBe(
      transferred.status === 201 ? target.body.id : source.body.id,
    );
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
      const requestId = crypto.randomUUID();
      const transition = () =>
        request(app.getHttpServer())
          .patch(`/api/v1/fulfillment/tickets/${ticketId}`)
          .set("Authorization", `Bearer ${ownerAccessToken}`)
          .send({ action, requestId });
      const responses = await Promise.all([transition(), transition()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses.map((response) => response.body.status)).toEqual([
        expectedStatus,
        expectedStatus,
      ]);
    }
    const { prisma } = await import("@cinema/database");
    expect(await prisma.restaurantOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .toMatchObject({ status: "PARTIALLY_DELIVERED" });

    const server = await request(app.getHttpServer())
      .post("/api/v1/auth/staff/login")
      .send({ email: `server@${SEED_SUFFIX}`, password: SEED_PASSWORD });
    const requestId = crypto.randomUUID();
    const refireRequest = () =>
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-tabs/fulfillment/${ticketId}/refire`)
        .set("Authorization", `Bearer ${server.body.accessToken}`)
        .send({ requestId });
    const refires = await Promise.all([refireRequest(), refireRequest()]);
    expect(refires.map((response) => response.status)).toEqual([201, 201]);
    expect(refires[0].body).toMatchObject({
      status: "NEW",
      refiredFromId: ticketId,
      refireCount: 1,
    });
    expect(refires[1].body.id).toBe(refires[0].body.id);
    expect(
      await prisma.fulfillmentTicket.count({ where: { refiredFromId: ticketId } }),
    ).toBe(1);
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
  it("allows only one distinct settlement request to collect a tab", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: { locationId: true },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const owner = await prisma.employee.findUniqueOrThrow({
      where: { email: `owner@${SEED_SUFFIX}` },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        tabType: "WALK_IN",
        label: "Distinct settlement race",
        status: "READY_TO_CLOSE",
        checkDroppedAt: new Date(),
      },
    });
    const order = await prisma.restaurantOrder.create({
      data: {
        restaurantTabId: tab.id,
        serverEmployeeId: owner.id,
        status: "SENT",
        placedAt: new Date(),
      },
    });
    await prisma.restaurantOrderItem.create({
      data: {
        restaurantOrderId: order.id,
        menuItemId: cocktail.id,
        quantity: 1,
        unitPriceCentsSnapshot: cocktail.priceCents,
        modifierTotalCents: 0,
        selectedModifiers: [],
        status: "SENT",
        kitchenStationId: cocktail.kitchenStationId,
      },
    });
    const totalCents = cocktail.priceCents;
    const finalize = (readerId: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/restaurant-settlement/tabs/${tab.id}/finalize`)
        .set("Authorization", `Bearer ${ownerAccessToken}`)
        .send({
          requestId: crypto.randomUUID(),
          tipCents: 0,
          tenders: [{ type: "CARD_PRESENT", amountCents: totalCents, readerId }],
        });

    const [first, second] = await Promise.all([
      finalize("tmr_delayed_settlement_race_first"),
      finalize("tmr_delayed_settlement_race_second"),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.payment.count({
        where: { restaurantTabId: tab.id, status: "SUCCEEDED" },
      }),
    ).toBe(1);
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).toMatchObject({ status: "CLOSED", totalCents });
  });

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
    await request(app.getHttpServer())
      .post(`/api/v1/restaurant-settlement/tabs/${milestone8TabId}/finalize`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({
        requestId: "88000000-0000-0000-0000-000000000001",
        tipCents: 881,
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
      })
      .expect(409);
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

  it("replays an exact completed customer tab payment without charging again", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: {
        locationId: true,
        primaryCustomerId: true,
        primaryCustomer: { select: { email: true } },
        activePaymentMethodId: true,
      },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Customer payment replay fixture",
        status: "OPEN",
        activePaymentMethodId: source.activePaymentMethodId,
        orders: {
          create: {
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
        },
      },
    });
    const settlement = app.get(RestaurantSettlementService);
    const { EMAIL_PROVIDER } = await import(
      "../src/notifications/notifications.module"
    );
    const { TestEmailProvider } = await import("@cinema/notifications");
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    const receiptsBefore = emailProvider.sentRestaurantReceipts.length;
    const request = {
      tabId: tab.id,
      customerId: source.primaryCustomerId!,
      requestId: "88000000-0000-0000-0000-000000000002",
      tipCents: 100,
      paymentMethodReferenceId: source.activePaymentMethodId!,
    };

    const paid = await settlement.payCustomer(request);
    const replayed = await settlement.payCustomer(request);

    expect(paid).toMatchObject({
      status: "CLOSED",
      receipt: { receiptNumber: expect.any(String) },
    });
    expect(replayed).toMatchObject({
      status: "CLOSED",
      receipt: { receiptNumber: paid.receipt!.receiptNumber },
    });
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    const receipts = emailProvider.sentRestaurantReceipts.slice(receiptsBefore);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      to: source.primaryCustomer!.email,
      receiptNumber: paid.receipt!.receiptNumber,
      totalCents: paid.receipt!.totalCents,
      currency: "usd",
    });
    await expect(
      settlement.payCustomer({
        ...request,
        requestId: "88000000-0000-0000-0000-000000000003",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows only one distinct customer payment request to collect a tab", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: {
        locationId: true,
        primaryCustomerId: true,
        activePaymentMethodId: true,
      },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Distinct customer payment race fixture",
        status: "OPEN",
        activePaymentMethodId: source.activePaymentMethodId,
        orders: {
          create: {
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
        },
      },
    });
    const settlement = app.get(RestaurantSettlementService);
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const chargesBefore = provider.chargeSavedPaymentMethodCalls.length;
    const pay = (requestId: string) =>
      settlement.payCustomer({
        tabId: tab.id,
        customerId: source.primaryCustomerId!,
        requestId,
        tipCents: 0,
        paymentMethodReferenceId: source.activePaymentMethodId!,
      });

    const results = await Promise.allSettled([
      pay("88000000-0000-0000-0000-000000000005"),
      pay("88000000-0000-0000-0000-000000000006"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect(provider.chargeSavedPaymentMethodCalls).toHaveLength(chargesBefore + 1);
    expect(
      await prisma.payment.count({
        where: { restaurantTabId: tab.id, status: "SUCCEEDED" },
      }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("does not let staff collect a tab while customer payment is processing", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { activePaymentMethod: true },
    });
    const delayedMethod = await prisma.paymentMethodReference.create({
      data: {
        paymentCustomerId: source.activePaymentMethod!.paymentCustomerId,
        provider: "test",
        providerPaymentMethodId: "pm_delayed_staff_customer_race",
        brand: "visa",
        last4: "0006",
        expMonth: 12,
        expYear: 2035,
      },
    });
    const owner = await prisma.employee.findUniqueOrThrow({
      where: { email: `owner@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Staff customer payment race fixture",
        status: "OPEN",
        activePaymentMethodId: delayedMethod.id,
        orders: {
          create: {
            serverEmployeeId: owner.id,
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
        },
      },
    });
    const settlement = app.get(RestaurantSettlementService);

    const customerPayment = settlement.payCustomer({
      tabId: tab.id,
      customerId: source.primaryCustomerId!,
      requestId: "88000000-0000-0000-0000-000000000009",
      tipCents: 0,
      paymentMethodReferenceId: delayedMethod.id,
    });
    let customerPaymentPending = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await prisma.restaurantTab.findUniqueOrThrow({
        where: { id: tab.id },
        select: { status: true },
      });
      if (current.status === "SETTLEMENT_PENDING") {
        customerPaymentPending = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(customerPaymentPending).toBe(true);
    await prisma.restaurantTab.update({
      where: { id: tab.id },
      data: { checkDroppedAt: new Date(), checkDroppedByEmployeeId: owner.id },
    });

    await expect(
      settlement.finalizeStaff({
        tabId: tab.id,
        locationId: source.locationId,
        employeeId: owner.id,
        requestId: "88000000-0000-0000-0000-000000000010",
        tipCents: 0,
        tenders: [
          { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_staff_customer_race" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(customerPayment).resolves.toMatchObject({ status: "CLOSED" });
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("does not let a customer collect a tab while staff payment is processing", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { activePaymentMethod: true },
    });
    const owner = await prisma.employee.findUniqueOrThrow({
      where: { email: `owner@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Customer during staff payment race fixture",
        status: "READY_TO_CLOSE",
        checkDroppedAt: new Date(),
        checkDroppedByEmployeeId: owner.id,
        activePaymentMethodId: source.activePaymentMethodId,
        orders: {
          create: {
            serverEmployeeId: owner.id,
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
        },
      },
    });
    const settlement = app.get(RestaurantSettlementService);
    const tabView = await settlement.staffTab(tab.id, source.locationId);

    const staffPayment = settlement.finalizeStaff({
      tabId: tab.id,
      locationId: source.locationId,
      employeeId: owner.id,
      requestId: "88000000-0000-0000-0000-000000000011",
      tipCents: 0,
      tenders: [
        {
          type: "CARD_PRESENT",
          amountCents: tabView.totals.totalCents,
          readerId: "tmr_delayed_customer_during_staff_race",
        },
      ],
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await prisma.restaurantTab.findUniqueOrThrow({
        where: { id: tab.id },
        select: { status: true },
      });
      if (current.status === "SETTLEMENT_PENDING") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await expect(
      settlement.payCustomer({
        tabId: tab.id,
        customerId: source.primaryCustomerId!,
        requestId: "88000000-0000-0000-0000-000000000012",
        tipCents: 0,
        paymentMethodReferenceId: source.activePaymentMethodId!,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(staffPayment).resolves.toMatchObject({ status: "CLOSED" });
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("does not let fallback collect a tab while staff payment is processing", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: {
        locationId: true,
        primaryCustomerId: true,
        showtimeId: true,
        activePaymentMethodId: true,
      },
    });
    const owner = await prisma.employee.findUniqueOrThrow({
      where: { email: `owner@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "SEAT_LINKED",
        showtimeId: source.showtimeId,
        status: "PREAUTHORIZED",
        autoSettleAuthorized: true,
        activePaymentMethodId: source.activePaymentMethodId,
        orders: {
          create: {
            serverEmployeeId: owner.id,
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
        },
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
    await prisma.showtime.update({
      where: { id: source.showtimeId! },
      data: { endsAt: new Date(Date.now() - 10 * 60_000) },
    });
    const settlement = app.get(RestaurantSettlementService);
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { TestPaymentProvider } = await import("@cinema/payments");
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const cardPresentCallsBefore =
      provider.collectCardPresentPaymentCalls.length;
    await settlement.dropCheck({
      tabId: tab.id,
      locationId: source.locationId,
      employeeId: owner.id,
    });
    const tabView = await settlement.staffTab(tab.id, source.locationId);

    const staffPayment = settlement.finalizeStaff({
      tabId: tab.id,
      locationId: source.locationId,
      employeeId: owner.id,
      requestId: "88000000-0000-0000-0000-000000000013",
      tipCents: 0,
      tenders: [
        {
          type: "CARD_PRESENT",
          amountCents: tabView.totals.totalCents,
          readerId: "tmr_delayed_fallback_during_staff_race",
        },
      ],
    });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (
        provider.collectCardPresentPaymentCalls.length ===
        cardPresentCallsBefore + 1
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(provider.collectCardPresentPaymentCalls).toHaveLength(
      cardPresentCallsBefore + 1,
    );
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "SETTLEMENT_PENDING" });

    const fallbackResults = await settlement.runFallback();
    expect(fallbackResults.map((result) => result.id)).not.toContain(tab.id);
    await expect(staffPayment).resolves.toMatchObject({ status: "CLOSED" });
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
  });

  it("keeps a restaurant tab closed and audits a failed receipt email", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { EMAIL_PROVIDER } = await import(
      "../src/notifications/notifications.module"
    );
    const { TestEmailProvider } = await import("@cinema/notifications");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      select: {
        locationId: true,
        primaryCustomerId: true,
        activePaymentMethodId: true,
      },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "WALK_IN",
        label: "Receipt email failure fixture",
        status: "OPEN",
        activePaymentMethodId: source.activePaymentMethodId,
        orders: {
          create: {
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
        },
      },
    });
    const settlement = app.get(RestaurantSettlementService);
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    jest
      .spyOn(emailProvider, "sendRestaurantReceipt")
      .mockRejectedValueOnce(new Error("Email provider unavailable"));

    await expect(
      settlement.payCustomer({
        tabId: tab.id,
        customerId: source.primaryCustomerId!,
        requestId: "88000000-0000-0000-0000-000000000004",
        tipCents: 100,
        paymentMethodReferenceId: source.activePaymentMethodId!,
      }),
    ).resolves.toMatchObject({ status: "CLOSED" });
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
    expect(
      await prisma.auditEvent.count({
        where: {
          entityId: tab.id,
          action: "restaurant_tab.receipt_notification_failed",
        },
      }),
    ).toBe(1);
  });

  it("runs fallback once, does not retry a failed card, and surfaces attention", async () => {
    const { prisma } = await import("@cinema/database");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: {
        activePaymentMethod: { include: { paymentCustomer: true } },
        primaryCustomer: true,
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
    const { EMAIL_PROVIDER } = await import(
      "../src/notifications/notifications.module"
    );
    const { TestEmailProvider } = await import("@cinema/notifications");
    const settlement = app.get(RestaurantSettlementService);
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<
      typeof TestEmailProvider
    >;
    const noticesBefore = emailProvider.sentRestaurantPaymentFailures.length;
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
    const notices = emailProvider.sentRestaurantPaymentFailures.slice(
      noticesBefore,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      to: source.primaryCustomer!.email,
      tabId: tab.id,
      amountDueCents: expect.any(Number),
      currency: "usd",
    });
    expect(notices[0]!.amountDueCents).toBeGreaterThan(0);
    const recoveryUrl = new URL(notices[0]!.paymentUrl);
    expect(`${recoveryUrl.origin}${recoveryUrl.pathname}`).toBe(
      `${CUSTOMER_WEB_ORIGIN}/account`,
    );
    const guestToken = recoveryUrl.searchParams.get("restaurantTab");
    expect(guestToken).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/api/v1/public/restaurant-tabs/${encodeURIComponent(guestToken!)}`)
      .expect(200);

    jest
      .spyOn(emailProvider, "sendRestaurantPaymentFailed")
      .mockRejectedValueOnce(new Error("Email provider unavailable"));
    await (
      settlement as unknown as {
        notifyPaymentFailure(tabId: string): Promise<void>;
      }
    ).notifyPaymentFailure(tab.id);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "PAYMENT_FAILED" });
    expect(
      await prisma.auditEvent.count({
        where: {
          entityId: tab.id,
          action: "restaurant_tab.payment_failure_notification_failed",
        },
      }),
    ).toBe(1);
  });

  it("allows only one concurrent fallback worker to collect an overdue tab", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { TestPaymentProvider } = await import("@cinema/payments");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: {
        activePaymentMethod: { include: { paymentCustomer: true } },
        showtime: true,
      },
    });
    const delayedMethod = await prisma.paymentMethodReference.create({
      data: {
        paymentCustomerId: source.activePaymentMethod!.paymentCustomerId,
        provider: "test",
        providerPaymentMethodId: "pm_delayed_fallback_race",
        brand: "visa",
        last4: "0003",
        expMonth: 12,
        expYear: 2035,
      },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "SEAT_LINKED",
        showtimeId: source.showtimeId,
        status: "PREAUTHORIZED",
        autoSettleAuthorized: true,
        activePaymentMethodId: delayedMethod.id,
        orders: {
          create: {
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
        },
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
    await prisma.showtime.update({
      where: { id: source.showtimeId! },
      data: { endsAt: new Date(Date.now() - 10 * 60_000) },
    });
    const settlement = app.get(RestaurantSettlementService);
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const chargesBefore = provider.chargeSavedPaymentMethodCalls.length;

    const results = await Promise.allSettled([
      settlement.runFallback(),
      settlement.runFallback(),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    expect(provider.chargeSavedPaymentMethodCalls).toHaveLength(chargesBefore + 1);
    expect(
      await prisma.payment.count({
        where: { restaurantTabId: tab.id, status: "SUCCEEDED" },
      }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("does not let staff collect a tab while fallback settlement is processing", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { activePaymentMethod: true },
    });
    const delayedMethod = await prisma.paymentMethodReference.create({
      data: {
        paymentCustomerId: source.activePaymentMethod!.paymentCustomerId,
        provider: "test",
        providerPaymentMethodId: "pm_slow_staff_fallback_race",
        brand: "visa",
        last4: "0004",
        expMonth: 12,
        expYear: 2035,
      },
    });
    const owner = await prisma.employee.findUniqueOrThrow({
      where: { email: `owner@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "SEAT_LINKED",
        showtimeId: source.showtimeId,
        status: "PREAUTHORIZED",
        autoSettleAuthorized: true,
        activePaymentMethodId: delayedMethod.id,
        orders: {
          create: {
            serverEmployeeId: owner.id,
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
        },
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
    await prisma.showtime.update({
      where: { id: source.showtimeId! },
      data: { endsAt: new Date(Date.now() - 10 * 60_000) },
    });
    const settlement = app.get(RestaurantSettlementService);

    const fallback = settlement.runFallback();
    let fallbackStarted = false;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const current = await prisma.restaurantTab.findUniqueOrThrow({
        where: { id: tab.id },
        select: { status: true },
      });
      if (current.status === "SETTLEMENT_PENDING") {
        fallbackStarted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fallbackStarted).toBe(true);
    await prisma.restaurantTab.update({
      where: { id: tab.id },
      data: { checkDroppedAt: new Date(), checkDroppedByEmployeeId: owner.id },
    });

    await expect(
      settlement.finalizeStaff({
        tabId: tab.id,
        locationId: source.locationId,
        employeeId: owner.id,
        requestId: "88000000-0000-0000-0000-000000000007",
        tipCents: 0,
        tenders: [
          { type: "CARD_PRESENT", amountCents: 1, readerId: "tmr_staff_fallback_race" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(fallback).resolves.toHaveLength(1);
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("does not let a customer collect a tab while fallback settlement is processing", async () => {
    const { prisma } = await import("@cinema/database");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { activePaymentMethod: true },
    });
    const delayedMethod = await prisma.paymentMethodReference.create({
      data: {
        paymentCustomerId: source.activePaymentMethod!.paymentCustomerId,
        provider: "test",
        providerPaymentMethodId: "pm_delayed_customer_fallback_race",
        brand: "visa",
        last4: "0005",
        expMonth: 12,
        expYear: 2035,
      },
    });
    const server = await prisma.employee.findFirstOrThrow({
      where: { email: `server@${SEED_SUFFIX}` },
    });
    const cocktail = await prisma.menuItem.findFirstOrThrow({
      where: { name: "Old Fashioned" },
    });
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        primaryCustomerId: source.primaryCustomerId,
        tabType: "SEAT_LINKED",
        showtimeId: source.showtimeId,
        status: "PREAUTHORIZED",
        autoSettleAuthorized: true,
        activePaymentMethodId: delayedMethod.id,
        orders: {
          create: {
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
        },
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
    await prisma.showtime.update({
      where: { id: source.showtimeId! },
      data: { endsAt: new Date(Date.now() - 10 * 60_000) },
    });
    const settlement = app.get(RestaurantSettlementService);

    const fallback = settlement.runFallback();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await prisma.restaurantTab.findUniqueOrThrow({
        where: { id: tab.id },
        select: { status: true },
      });
      if (current.status === "SETTLEMENT_PENDING") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await expect(
      settlement.payCustomer({
        tabId: tab.id,
        customerId: source.primaryCustomerId!,
        requestId: "88000000-0000-0000-0000-000000000008",
        tipCents: 0,
        paymentMethodReferenceId: delayedMethod.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(fallback).resolves.toHaveLength(1);
    expect(
      await prisma.payment.count({ where: { restaurantTabId: tab.id } }),
    ).toBe(1);
    await expect(
      prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("reconciles a processing restaurant payment and closes the paid tab", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { TestPaymentProvider } = await import("@cinema/payments");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { location: { include: { organization: true } } },
    });
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const intent = await provider.createPaymentIntent({
      connectedAccountId:
        source.location.organization.stripeConnectedAccountId ?? undefined,
      amountCents: 500,
      currency: source.location.currency,
      metadata: { restaurantTabId: "pending-reconciliation-fixture" },
      idempotencyKey: crypto.randomUUID(),
    });
    provider.setIntentStatus(intent.id, "PROCESSING");
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        tabType: "WALK_IN",
        label: "Processing reconciliation fixture",
        status: "SETTLEMENT_PENDING",
        subtotalCents: 500,
        taxCents: 0,
        serviceChargeCents: 0,
        selectedTipCents: 0,
        totalCents: 500,
        payments: {
          create: {
            purpose: "RESTAURANT_TAB",
            amountCents: 500,
            tipCents: 0,
            currency: source.location.currency,
            status: "PROCESSING",
            idempotencyKey: crypto.randomUUID(),
            provider: provider.name,
            providerPaymentId: intent.id,
          },
        },
      },
      include: { payments: true },
    });

    provider.setIntentStatus(intent.id, "SUCCEEDED");
    const result = await app
      .get(RestaurantSettlementService)
      .reconcileProcessingPayments();

    expect(result).toMatchObject({ resolved: 1, errors: 0 });
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).toMatchObject({ status: "CLOSED", closedAt: expect.any(Date) });
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: tab.payments[0]!.id } }),
    ).toMatchObject({ status: "SUCCEEDED", providerPaymentId: intent.id });
    expect(
      await prisma.restaurantReceipt.findUnique({
        where: { restaurantTabId: tab.id },
      }),
    ).toMatchObject({ totalCents: 500 });
  });

  it("reconciles a failed processing payment without closing the tab", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { TestPaymentProvider } = await import("@cinema/payments");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { location: { include: { organization: true } } },
    });
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const intent = await provider.createPaymentIntent({
      connectedAccountId:
        source.location.organization.stripeConnectedAccountId ?? undefined,
      amountCents: 500,
      currency: source.location.currency,
      metadata: { restaurantTabId: "failed-reconciliation-fixture" },
      idempotencyKey: crypto.randomUUID(),
    });
    provider.setIntentStatus(intent.id, "PROCESSING");
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        tabType: "WALK_IN",
        label: "Failed reconciliation fixture",
        status: "SETTLEMENT_PENDING",
        subtotalCents: 500,
        taxCents: 0,
        serviceChargeCents: 0,
        selectedTipCents: 0,
        totalCents: 500,
        payments: {
          create: {
            purpose: "RESTAURANT_TAB",
            amountCents: 500,
            tipCents: 0,
            currency: source.location.currency,
            status: "PROCESSING",
            idempotencyKey: crypto.randomUUID(),
            provider: provider.name,
            providerPaymentId: intent.id,
          },
        },
      },
      include: { payments: true },
    });

    provider.setIntentStatus(intent.id, "FAILED");
    const result = await app
      .get(RestaurantSettlementService)
      .reconcileProcessingPayments();

    expect(result).toMatchObject({ resolved: 1, errors: 0 });
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).toMatchObject({ status: "PAYMENT_FAILED", closedAt: null });
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: tab.payments[0]!.id } }),
    ).toMatchObject({ status: "FAILED", providerPaymentId: intent.id });
    expect(
      await prisma.restaurantReceipt.findUnique({
        where: { restaurantTabId: tab.id },
      }),
    ).toBeNull();
  });

  it("leaves a still-processing restaurant payment pending without extra attempts", async () => {
    const { prisma } = await import("@cinema/database");
    const { PAYMENT_PROVIDER } = await import("../src/payments/payments.module");
    const { RestaurantSettlementService } = await import(
      "../src/restaurant/restaurant-settlement.service"
    );
    const { TestPaymentProvider } = await import("@cinema/payments");
    const source = await prisma.restaurantTab.findUniqueOrThrow({
      where: { id: milestone8TabId },
      include: { location: { include: { organization: true } } },
    });
    const provider = app.get(PAYMENT_PROVIDER) as InstanceType<
      typeof TestPaymentProvider
    >;
    const intent = await provider.createPaymentIntent({
      connectedAccountId:
        source.location.organization.stripeConnectedAccountId ?? undefined,
      amountCents: 500,
      currency: source.location.currency,
      metadata: { restaurantTabId: "pending-unchanged-fixture" },
      idempotencyKey: crypto.randomUUID(),
    });
    provider.setIntentStatus(intent.id, "PROCESSING");
    const tab = await prisma.restaurantTab.create({
      data: {
        locationId: source.locationId,
        tabType: "WALK_IN",
        label: "Still processing reconciliation fixture",
        status: "SETTLEMENT_PENDING",
        subtotalCents: 500,
        taxCents: 0,
        serviceChargeCents: 0,
        selectedTipCents: 0,
        totalCents: 500,
        payments: {
          create: {
            purpose: "RESTAURANT_TAB",
            amountCents: 500,
            tipCents: 0,
            currency: source.location.currency,
            status: "PROCESSING",
            idempotencyKey: crypto.randomUUID(),
            provider: provider.name,
            providerPaymentId: intent.id,
          },
        },
      },
      include: { payments: true },
    });

    const result = await app
      .get(RestaurantSettlementService)
      .reconcileProcessingPayments();

    expect(result).toMatchObject({ pending: 1, resolved: 0, errors: 0 });
    expect(
      await prisma.restaurantTab.findUniqueOrThrow({ where: { id: tab.id } }),
    ).toMatchObject({ status: "SETTLEMENT_PENDING", closedAt: null });
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: tab.payments[0]!.id } }),
    ).toMatchObject({ status: "PROCESSING", providerPaymentId: intent.id });
    expect(
      await prisma.paymentAttempt.count({
        where: { paymentId: tab.payments[0]!.id },
      }),
    ).toBe(0);
    expect(
      await prisma.restaurantReceipt.findUnique({
        where: { restaurantTabId: tab.id },
      }),
    ).toBeNull();
  });
});

describe("Milestone 9 box office and workforce", () => {
  it("clocks staff in by PIN, rejects duplicate punches, records breaks, and clocks out", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const body = { locationId: owner.locationId, employeeId: owner.id, pin: "1234", requestId: crypto.randomUUID() };
    const clockIn = await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(201);
    const replayedClockIn = await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(201);
    expect(replayedClockIn.body.id).toBe(clockIn.body.id);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send({ ...body, requestId: crypto.randomUUID() }).expect(409);
    const breakStart = await request(app.getHttpServer()).post("/api/v1/shifts/break/start").send(body).expect(201);
    const replayedBreakStart = await request(app.getHttpServer()).post("/api/v1/shifts/break/start").send(body).expect(201);
    expect(replayedBreakStart.body.breakStartAt).toBe(breakStart.body.breakStartAt);
    await request(app.getHttpServer()).post("/api/v1/shifts/break/start").send({ ...body, requestId: crypto.randomUUID() }).expect(409);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send(body).expect(409);
    const breakEndBody = { ...body, requestId: crypto.randomUUID() };
    const breakEnd = await request(app.getHttpServer()).post("/api/v1/shifts/break/end").send(breakEndBody).expect(201);
    const replayedBreakEnd = await request(app.getHttpServer()).post("/api/v1/shifts/break/end").send(breakEndBody).expect(201);
    expect(replayedBreakEnd.body.breakEndAt).toBe(breakEnd.body.breakEndAt);
    await request(app.getHttpServer()).post("/api/v1/shifts/break/end").send({ ...breakEndBody, requestId: crypto.randomUUID() }).expect(409);
    const { WorkforceRateLimitGuard } = await import("../src/workforce/workforce-rate-limit.guard");
    app.get(WorkforceRateLimitGuard).resetForTests();
    const clockOutBody = { ...body, requestId: crypto.randomUUID() };
    const clockOut = await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send(clockOutBody).expect(201);
    const replayedClockOut = await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send(clockOutBody).expect(201);
    expect(replayedClockOut.body.clockOutAt).toBe(clockOut.body.clockOutAt);
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-out").send({ ...clockOutBody, requestId: crypto.randomUUID() }).expect(409);
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: clockIn.body.id } });
    expect(shift.clockOutAt).not.toBeNull();
    expect(shift.breakStartAt).not.toBeNull();
    expect(shift.breakEndAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "Shift", entityId: shift.id } })).toBe(4);
    const correctedClockOut = new Date(shift.clockOutAt!.getTime() + 60_000).toISOString();
    await request(app.getHttpServer()).patch(`/api/v1/shifts/${shift.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ breakEndAt: new Date(new Date(correctedClockOut).getTime() + 60_000).toISOString(), notes: "Invalid correction" }).expect(400);
    const shiftAdjustmentKey = crypto.randomUUID();
    const adjustShift = () => request(app.getHttpServer()).patch(`/api/v1/shifts/${shift.id}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .set("Idempotency-Key", shiftAdjustmentKey)
      .send({ clockOutAt: correctedClockOut, notes: "Manager correction for E2E verification" });
    const [adjusted, adjustmentReplay] = await Promise.all([adjustShift(), adjustShift()]);
    expect(adjusted.status).toBe(200);
    expect(adjustmentReplay.body).toEqual(adjusted.body);
    expect(await prisma.auditEvent.count({ where: { entityType: "Shift", entityId: shift.id, action: "shift.manager_adjusted" } })).toBe(1);
  });

  it("records one cash movement when identical register requests arrive concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `MOVEMENT-${crypto.randomUUID()}`, openingBalanceCents: 20000 }).expect(201);
    const idempotencyKey = crypto.randomUUID();
    const payload = { type: "PAID_IN", amountCents: 2500, reason: "Concurrent paid-in test", idempotencyKey };

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/box-office/cash-drawers/${drawer.body.id}/movements`).set("Authorization", `Bearer ${ownerAccessToken}`).send(payload),
      request(app.getHttpServer()).post(`/api/v1/box-office/cash-drawers/${drawer.body.id}/movements`).set("Authorization", `Bearer ${ownerAccessToken}`).send(payload),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.cashTransaction.count({ where: { idempotencyKey } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityType: "CashTransaction", entityId: first.body.id, action: "cash_drawer.paid_in" } })).toBe(1);
  });

  it("replays a completed cash drawer open without creating another drawer", async () => {
    const { prisma } = await import("@cinema/database");
    const { BoxOfficeService } = await import("../src/box-office/box-office.service");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const registerId = `OPEN-REPLAY-${crypto.randomUUID()}`;
    const requestId = crypto.randomUUID();
    const input = { locationId: owner.locationId, employeeId: owner.id, requestId, registerId, openingBalanceCents: 20000 };
    const boxOffice = app.get(BoxOfficeService);

    const opened = await boxOffice.openDrawer(input);
    const replayed = await boxOffice.openDrawer(input);
    expect(replayed.id).toBe(opened.id);
    expect(await prisma.cashDrawer.count({ where: { locationId: owner.locationId, registerId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "cash_drawer.opened", entityId: opened.id } })).toBe(1);
    await expect(boxOffice.openDrawer({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(boxOffice.openDrawer({ ...input, openingBalanceCents: 19900 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("replays a completed cash drawer close without duplicating its audit event", async () => {
    const { prisma } = await import("@cinema/database");
    const { BoxOfficeService } = await import("../src/box-office/box-office.service");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const drawer = await prisma.cashDrawer.create({ data: { locationId: owner.locationId, registerId: `CLOSE-REPLAY-${crypto.randomUUID()}`, openingBalanceCents: 20000, openedByEmployeeId: owner.id } });
    const requestId = crypto.randomUUID();
    const input = { drawerId: drawer.id, locationId: owner.locationId, employeeId: owner.id, requestId, closingBalanceCents: 20000 };
    const boxOffice = app.get(BoxOfficeService);

    const closed = await boxOffice.closeDrawer(input);
    const replayed = await boxOffice.closeDrawer(input);
    expect(replayed.id).toBe(closed.id);
    expect(await prisma.auditEvent.count({ where: { action: "cash_drawer.closed", entityId: drawer.id } })).toBe(1);
    await expect(boxOffice.closeDrawer({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(boxOffice.closeDrawer({ ...input, closingBalanceCents: 19900 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a cash movement id reused with a different reason", async () => {
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `REPLAY-${crypto.randomUUID()}`, openingBalanceCents: 20000 }).expect(201);
    const idempotencyKey = crypto.randomUUID();
    const endpoint = `/api/v1/box-office/cash-drawers/${drawer.body.id}/movements`;
    await request(app.getHttpServer()).post(endpoint).set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ type: "PAID_OUT", amountCents: 1200, reason: "Courier cash", idempotencyKey }).expect(201);
    await request(app.getHttpServer()).post(endpoint).set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ type: "PAID_OUT", amountCents: 1200, reason: "Petty cash", idempotencyKey }).expect(409);
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
    const quoteBody = { holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id, promotionCode: promotion.code };

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
      include: { showtime: { include: { priceTier: true } } },
    });
    const ticketType = await prisma.ticketType.create({
      data: { locationId: owner.locationId, name: `Box Office Child ${crypto.randomUUID()}`, priceAdjustmentMinor: -200 },
    });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: "E2E-BOX", openingBalanceCents: 20000 }).expect(201);
    const holderKey = `box-office-e2e-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);

    // The public channel sees the same hold and cannot acquire a second one.
    await request(app.getHttpServer()).post(`/api/v1/cinema/showtimes/${inventory.showtimeId}/holds`)
      .send({ seatIds: [inventory.seatId], holderKey: `online-e2e-${crypto.randomUUID()}` }).expect(409);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id }).expect(201);
    expect(quote.body).toMatchObject({
      subtotalCents: Math.max(0, inventory.showtime.priceTier.ticketPriceMinor + ticketType.priceAdjustmentMinor),
      ticketType: { id: ticketType.id, name: ticketType.name, priceCents: Math.max(0, inventory.showtime.priceTier.ticketPriceMinor + ticketType.priceAdjustmentMinor) },
    });
    const cashCents = Math.floor(quote.body.totalCents / 2);
    const cardCents = quote.body.totalCents - cashCents;
    const customerEmail = `box-office-${crypto.randomUUID()}@example.test`;
    const { EMAIL_PROVIDER } = await import("../src/notifications/notifications.module");
    const { TestEmailProvider } = await import("@cinema/notifications");
    const emailProvider = app.get(EMAIL_PROVIDER) as InstanceType<typeof TestEmailProvider>;
    const receiptsBefore = emailProvider.sent.length;
    const saleRequestId = crypto.randomUUID();
    const salePayload = {
      requestId: saleRequestId, holdTokens: [holds.body[0].holdToken], holderKey,
      ticketTypeId: ticketType.id, cashDrawerId: drawer.body.id, cashCents, cardCents,
      cashReceivedCents: cashCents + 500, readerId: "tmr_e2e_box",
      customerName: "Box Office Customer", customerEmail,
    };
    const sale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(salePayload).expect(201);
    expect(sale.body.status).toBe("PAID");
    expect(sale.body.receiptDelivery).toBe("SENT");
    expect(sale.body.tickets).toHaveLength(1);
    expect(sale.body.tickets[0]).toMatchObject({ ticketType: { id: ticketType.id, name: ticketType.name }, priceCentsPaid: quote.body.subtotalCents });
    expect(sale.body.cashTransactions[0]).toMatchObject({ amountCents: cashCents, changeGivenCents: 500 });
    expect(sale.body.payment).toMatchObject({ amountCents: cardCents, status: "SUCCEEDED" });
    expect(emailProvider.sent.slice(receiptsBefore)).toEqual([expect.objectContaining({ to: customerEmail, guestName: "Box Office Customer", orderNumber: sale.body.orderNumber, tickets: [expect.objectContaining({ credential: expect.any(String) })] })]);
    const replayedSale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(salePayload).expect(201);
    expect(replayedSale.body).toEqual(expect.objectContaining({ id: sale.body.id, receiptDelivery: "SENT" }));
    expect(emailProvider.sent).toHaveLength(receiptsBefore + 1);

    const customerLookup = await request(app.getHttpServer())
      .get(`/api/v1/box-office/customers?q=${encodeURIComponent(customerEmail.slice(0, 18))}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(customerLookup.body).toEqual([expect.objectContaining({ name: "Box Office Customer", email: customerEmail })]);
    await request(app.getHttpServer()).get(`/api/v1/box-office/customers?q=${"A".repeat(101)}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).expect(400);

    const lookup = await request(app.getHttpServer())
      .get(`/api/v1/box-office/orders?q=${encodeURIComponent(sale.body.orderNumber)}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(200);
    expect(lookup.body).toEqual([
      expect.objectContaining({
        id: sale.body.id,
        orderNumber: sale.body.orderNumber,
        guestName: "Box Office Customer",
        guestEmail: customerEmail,
        tickets: [expect.objectContaining({ id: sale.body.tickets[0].id, status: "ISSUED" })],
      }),
    ]);
    await request(app.getHttpServer())
      .get("/api/v1/box-office/orders?q=A")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .expect(400);

    await request(app.getHttpServer()).post(`/api/v1/box-office/tickets/${sale.body.tickets[0].id}/reprint`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({}).expect(201);
    const correctedReceiptEmail = `corrected-${crypto.randomUUID()}@example.test`;
    const receiptRequestId = crypto.randomUUID();
    const resentReceipt = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/receipt`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: receiptRequestId, email: correctedReceiptEmail }).expect(201);
    expect(resentReceipt.body).toEqual({ receiptDelivery: "SENT", email: correctedReceiptEmail });
    expect(emailProvider.sent).toHaveLength(receiptsBefore + 2);
    expect(emailProvider.sent.at(-1)).toEqual(expect.objectContaining({ to: correctedReceiptEmail, orderNumber: sale.body.orderNumber }));
    await expect(prisma.ticketOrder.findUniqueOrThrow({ where: { id: sale.body.id } })).resolves.toMatchObject({ guestEmail: correctedReceiptEmail, receiptEmailError: null });
    expect(await prisma.auditEvent.count({ where: { action: "ticket_order.receipt_resent", entityId: sale.body.id, actorId: owner.id } })).toBe(1);
    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/receipt`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: receiptRequestId, email: correctedReceiptEmail }).expect(201);
    expect(emailProvider.sent).toHaveLength(receiptsBefore + 2);
    expect(await prisma.auditEvent.count({ where: { action: "ticket_order.receipt_resent", entityId: sale.body.id, actorId: owner.id } })).toBe(1);
    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/receipt`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: receiptRequestId, email: `other-${crypto.randomUUID()}@example.test` }).expect(409);
    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/receipt`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), email: "not-an-email" }).expect(400);
    const refundRequestId = crypto.randomUUID();
    const refundPayload = { requestId: refundRequestId, reason: "E2E full refund", cashDrawerId: drawer.body.id };
    const refunded = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(refundPayload).expect(201);
    expect(refunded.body.status).toBe("REFUNDED");
    expect(refunded.body.tickets[0].status).toBe("REFUNDED");
    const replayed = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(refundPayload).expect(201);
    expect(replayed.body.id).toBe(refunded.body.id);
    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ ...refundPayload, reason: "Changed reason" }).expect(409);
    expect(await prisma.cashTransaction.count({ where: { ticketOrderId: sale.body.id } })).toBe(2);
    expect(await prisma.refund.count({ where: { idempotencyKey: `box-office-refund:${refundRequestId}` } })).toBe(1);
    const history = await request(app.getHttpServer()).get(`/api/v1/management/refunds/history?query=${encodeURIComponent(sale.body.orderNumber)}`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(history.body.ticketOrders.map((order: { id: string }) => order.id)).toContain(sale.body.id);
    expect(history.body.ticketOrders.find((order: { id: string }) => order.id === sale.body.id).cashTransactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "REFUND" })]),
    );
    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { active: false } });
  });

  it("prices and issues mixed ticket types in one box-office sale", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const showtime = await prisma.showtime.findFirstOrThrow({
      where: { onSale: true, startsAt: { gt: new Date() }, auditorium: { locationId: owner.locationId } },
      include: { priceTier: true },
    });
    const inventory = await prisma.showtimeSeat.findMany({
      where: { showtimeId: showtime.id, blockedAt: null, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      take: 2,
      orderBy: { seatId: "asc" },
    });
    expect(inventory).toHaveLength(2);
    const adult = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const child = await prisma.ticketType.create({ data: { locationId: owner.locationId, name: `Mixed Child ${crypto.randomUUID()}`, priceAdjustmentMinor: -250 } });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `MIXED-${crypto.randomUUID()}`, openingBalanceCents: 20000 }).expect(201);
    const holderKey = `mixed-ticket-types-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${showtime.id}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: inventory.map((seat) => seat.seatId), holderKey }).expect(201);
    const selections = [
      { holdToken: holds.body[0].holdToken, ticketTypeId: adult.id },
      { holdToken: holds.body[1].holdToken, ticketTypeId: child.id },
    ];
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: selections.map((selection) => selection.holdToken), holderKey, ticketTypeId: adult.id, ticketTypeSelections: selections }).expect(201);
    expect(quote.body.subtotalCents).toBe(
      showtime.priceTier.ticketPriceMinor + Math.max(0, showtime.priceTier.ticketPriceMinor + child.priceAdjustmentMinor),
    );
    expect(quote.body.tickets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticketTypeId: adult.id, priceCents: showtime.priceTier.ticketPriceMinor }),
      expect.objectContaining({ ticketTypeId: child.id, priceCents: Math.max(0, showtime.priceTier.ticketPriceMinor + child.priceAdjustmentMinor) }),
    ]));
    const sale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), holdTokens: selections.map((selection) => selection.holdToken), holderKey, ticketTypeId: adult.id, ticketTypeSelections: selections, cashDrawerId: drawer.body.id, cashCents: quote.body.totalCents, cardCents: 0, cashReceivedCents: quote.body.totalCents }).expect(201);
    expect(sale.body.tickets).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticketTypeId: adult.id, priceCentsPaid: showtime.priceTier.ticketPriceMinor }),
      expect.objectContaining({ ticketTypeId: child.id, priceCentsPaid: Math.max(0, showtime.priceTier.ticketPriceMinor + child.priceAdjustmentMinor) }),
    ]));
  });

  it("replays a completed ticket exchange without creating another replacement", async () => {
    const { prisma } = await import("@cinema/database");
    const { BoxOfficeService } = await import("../src/box-office/box-office.service");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const originalInventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() }, auditorium: { locationId: owner.locationId } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      include: { showtime: { include: { priceTier: true } } },
    });
    const replacementStartsAt = new Date(originalInventory.showtime.startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const replacementShowtime = await prisma.showtime.create({
      data: {
        movieId: originalInventory.showtime.movieId,
        auditoriumId: originalInventory.showtime.auditoriumId,
        priceTierId: originalInventory.showtime.priceTierId,
        startsAt: replacementStartsAt,
        featureStartsAt: new Date(replacementStartsAt.getTime() + 30 * 60 * 1000),
        endsAt: new Date(replacementStartsAt.getTime() + 3 * 60 * 60 * 1000),
        roomReadyAt: new Date(replacementStartsAt.getTime() + 3.5 * 60 * 60 * 1000),
        onSale: true,
        showtimeSeats: { create: { seatId: originalInventory.seatId } },
      },
      include: { showtimeSeats: true },
    });
    const replacementInventory = replacementShowtime.showtimeSeats[0]!;
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const order = await prisma.ticketOrder.create({ data: {
      locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "BOX_OFFICE", status: "PAID",
      orderNumber: `EXCHANGE-REPLAY-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: originalInventory.showtime.priceTier.ticketPriceMinor, feesCents: 0, taxCents: 0, totalCents: originalInventory.showtime.priceTier.ticketPriceMinor,
      tickets: { create: { showtimeSeatId: originalInventory.id, ticketTypeId: ticketType.id, priceCentsPaid: originalInventory.showtime.priceTier.ticketPriceMinor, qrToken: `exchange-replay-${crypto.randomUUID()}` } },
    }, include: { tickets: true } });
    const holderKey = `exchange-replay-${crypto.randomUUID()}`;
    const holdToken = crypto.randomUUID();
    await prisma.seatHold.create({ data: { showtimeSeatId: replacementInventory.id, holdToken, holderKey, expiresAt: new Date(Date.now() + 300_000) } });
    const requestId = crypto.randomUUID();
    const input = { ticketId: order.tickets[0]!.id, locationId: owner.locationId, employeeId: owner.id, requestId, holdToken, holderKey, reason: "Customer requested another showing" };
    const boxOffice = app.get(BoxOfficeService);

    const exchanged = await boxOffice.exchangeTicket(input);
    const replayed = await boxOffice.exchangeTicket(input);
    expect(replayed.id).toBe(exchanged.id);
    expect(await prisma.ticket.count({ where: { ticketOrderId: order.id } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "ticket.exchanged", entityId: order.tickets[0]!.id } })).toBe(1);
    await expect(boxOffice.exchangeTicket({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(boxOffice.exchangeTicket({ ...input, reason: "Different reason" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a cash refund request id reused for a different order", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `REFUND-REPLAY-${crypto.randomUUID()}`, openingBalanceCents: 20000 }).expect(201);
    const orders = await Promise.all([0, 1].map((index) => prisma.ticketOrder.create({
      data: {
        locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(),
        channel: "BOX_OFFICE", status: "PAID", orderNumber: `REFUND-REPLAY-${index}-${crypto.randomUUID()}`,
        checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 1000, feesCents: 0, taxCents: 0, totalCents: 1000,
        placedByEmployeeId: owner.id,
      },
    })));
    await Promise.all(orders.map((order) => prisma.cashTransaction.create({
      data: {
        locationId: owner.locationId, cashDrawerId: drawer.body.id, ticketOrderId: order.id, employeeId: owner.id,
        type: "SALE", amountCents: 1000, cashReceivedCents: 1000, changeGivenCents: 0, idempotencyKey: `refund-replay-sale:${order.id}`,
      },
    })));
    const requestId = crypto.randomUUID();
    const payload = { requestId, reason: "Customer request", cashDrawerId: drawer.body.id };

    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${orders[0].id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(payload).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${orders[1].id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send(payload).expect(409);

    expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orders[1].id } })).toMatchObject({ status: "PAID" });
    expect(await prisma.cashTransaction.count({ where: { idempotencyKey: `box-office-cash-refund:${requestId}` } })).toBe(1);
  });

  it("reuses one cash box-office sale when identical register requests arrive concurrently", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `RACE-${crypto.randomUUID()}`, openingBalanceCents: 20000 }).expect(201);
    const holderKey = `box-office-race-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id }).expect(201);
    const requestId = crypto.randomUUID();
    const payload = { requestId, holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id, cashDrawerId: drawer.body.id, cashCents: quote.body.totalCents, cashReceivedCents: quote.body.totalCents };

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/box-office/checkouts").set("Authorization", `Bearer ${ownerAccessToken}`).send(payload),
      request(app.getHttpServer()).post("/api/v1/box-office/checkouts").set("Authorization", `Bearer ${ownerAccessToken}`).send(payload),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.status).toBe("PAID");
    expect(second.body.status).toBe("PAID");
    expect(await prisma.ticketOrder.count({ where: { checkoutIdempotencyKey: requestId } })).toBe(1);
    expect(await prisma.ticket.count({ where: { ticketOrderId: first.body.id } })).toBe(1);
    expect(await prisma.cashTransaction.count({ where: { ticketOrderId: first.body.id, type: "SALE" } })).toBe(1);

    await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`)
      .send({ ...payload, holderKey: `different-holder-${crypto.randomUUID()}` })
      .expect(409, {
        code: "CONFLICT",
        message: "The checkout request id was already used with different sale details.",
      });
  });

  it("redeems an active gift card atomically for a box-office ticket sale", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const issued = await request(app.getHttpServer()).post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ amountCents: 100_000 }).expect(201);
    const staffBalance = await request(app.getHttpServer()).post("/api/v1/box-office/gift-cards/balance")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ code: issued.body.code }).expect(201);
    expect(staffBalance.body).toEqual({ codeLast4: issued.body.codeLast4, balanceCents: 100_000, currency: issued.body.currency });
    const drawer = await request(app.getHttpServer()).post("/api/v1/box-office/cash-drawers")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: crypto.randomUUID(), registerId: `GIFT-${crypto.randomUUID()}`, openingBalanceCents: 20_000 }).expect(201);
    const holderKey = `gift-card-box-office-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id }).expect(201);
    const cashCents = 100;
    const giftCardCents = quote.body.totalCents - cashCents;
    const sale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({
        requestId: crypto.randomUUID(), holdTokens: [holds.body[0].holdToken], holderKey,
        ticketTypeId: ticketType.id, cashDrawerId: drawer.body.id, cashCents, cashReceivedCents: cashCents, cardCents: 0,
        giftCardCents, giftCardCode: issued.body.code,
      }).expect(201);

    expect(sale.body.status).toBe("PAID");
    const card = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id }, include: { transactions: { where: { type: "REDEMPTION" } } } });
    expect(card.balanceCents).toBe(100_000 - giftCardCents);
    expect(card.transactions).toEqual([expect.objectContaining({ amountCents: -giftCardCents, balanceAfterCents: card.balanceCents, reference: sale.body.id })]);

    const refundRequestId = crypto.randomUUID();
    const refunded = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: refundRequestId, reason: "E2E gift card refund", cashDrawerId: drawer.body.id }).expect(201);
    expect(refunded.body.status).toBe("REFUNDED");
    const restored = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id }, include: { transactions: { orderBy: { createdAt: "asc" } } } });
    expect(restored.balanceCents).toBe(100_000);
    expect(restored.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "REFUND", amountCents: giftCardCents, balanceAfterCents: 100_000, reference: `refund:${sale.body.id}:${refundRequestId}` }),
    ]));
    expect(await prisma.cashTransaction.count({ where: { ticketOrderId: sale.body.id } })).toBe(2);
  });

  it("splits a box-office sale and refund between gift card and card-present tender", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const inventory = await prisma.showtimeSeat.findFirstOrThrow({
      where: { blockedAt: null, showtime: { onSale: true, startsAt: { gt: new Date() } }, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: new Date() } } } },
    });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const issued = await request(app.getHttpServer()).post("/api/v1/management/gift-cards")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ amountCents: 500 }).expect(201);
    const holderKey = `gift-card-terminal-${crypto.randomUUID()}`;
    const holds = await request(app.getHttpServer()).post(`/api/v1/box-office/showtimes/${inventory.showtimeId}/holds`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ seatIds: [inventory.seatId], holderKey }).expect(201);
    const quote = await request(app.getHttpServer()).post("/api/v1/box-office/quotes")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id }).expect(201);
    const cardCents = quote.body.totalCents - 500;
    const sale = await request(app.getHttpServer()).post("/api/v1/box-office/checkouts")
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({
        requestId: crypto.randomUUID(), holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id,
        cashCents: 0, cardCents, readerId: "tmr_gift_card_split", giftCardCents: 500, giftCardCode: issued.body.code,
      }).expect(201);
    expect(sale.body.payment).toMatchObject({ amountCents: cardCents, status: "SUCCEEDED" });
    expect((await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id } })).balanceCents).toBe(0);

    const refundRequestId = crypto.randomUUID();
    const refunded = await request(app.getHttpServer()).post(`/api/v1/box-office/orders/${sale.body.id}/refund`)
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ requestId: refundRequestId, reason: "E2E split tender refund" }).expect(201);
    expect(refunded.body).toMatchObject({ status: "REFUNDED", payment: { amountCents: cardCents, status: "REFUNDED" } });
    const restored = await prisma.giftCard.findUniqueOrThrow({ where: { id: issued.body.id }, include: { transactions: true } });
    expect(restored.balanceCents).toBe(500);
    expect(restored.transactions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "REFUND", amountCents: 500, reference: `refund:${sale.body.id}:${refundRequestId}` })]));
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
      .set("Authorization", `Bearer ${ownerAccessToken}`).send({ holdTokens: [holds.body[0].holdToken], holderKey, ticketTypeId: ticketType.id }).expect(201);
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

  it("rejects a compensation refund request id reused for a different payment", async () => {
    const { prisma } = await import("@cinema/database");
    const { BoxOfficeService } = await import("../src/box-office/box-office.service");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: owner.locationId, active: true } });
    const orders = await Promise.all([0, 1].map((index) => prisma.ticketOrder.create({
      data: {
        locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(),
        channel: "BOX_OFFICE", status: "PAYMENT_FAILED", orderNumber: `COMPENSATION-REPLAY-${index}-${crypto.randomUUID()}`,
        checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 1000, feesCents: 0, taxCents: 0, totalCents: 1000,
        placedByEmployeeId: owner.id,
        payment: { create: { purpose: "TICKET_ORDER", amountCents: 1000, status: "SUCCEEDED", idempotencyKey: `compensation-payment:${crypto.randomUUID()}`, provider: "test", providerPaymentId: `pi_${crypto.randomUUID()}` } },
      },
      include: { payment: true },
    })));
    const requestId = crypto.randomUUID();
    await prisma.refund.create({ data: {
      paymentId: orders[0].payment!.id, amountCents: 1000, reason: "BOX_OFFICE_INVENTORY_FINALIZATION_FAILED",
      scope: "TICKET", idempotencyKey: `box-office-finalize-refund:${requestId}`,
    } });

    const service = app.get(BoxOfficeService) as unknown as { compensateFailedCardOrder(input: Record<string, unknown>): Promise<void> };
    await expect(service.compensateFailedCardOrder({
      orderId: orders[1].id, paymentId: orders[1].payment!.id, providerPaymentId: orders[1].payment!.providerPaymentId!,
      amountCents: 1000, requestId, locationId: owner.locationId, employeeId: owner.id,
    })).rejects.toMatchObject({
      status: 409,
      message: "The checkout request id was already used for a different compensation refund.",
    });

    expect(await prisma.refund.count({ where: { idempotencyKey: `box-office-finalize-refund:${requestId}` } })).toBe(1);
    expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: orders[1].id } })).toMatchObject({ status: "PAYMENT_FAILED" });
  });

  it("rate limits repeated public workforce PIN attempts", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const body = { locationId: owner.locationId, employeeId: crypto.randomUUID(), pin: "0000", requestId: crypto.randomUUID() };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(403);
    }
    await request(app.getHttpServer()).post("/api/v1/shifts/clock-in").send(body).expect(429);
  });
});

describe("Milestone 10 management reporting", () => {
  it("records concurrent expense retries once and rejects changed details", async () => {
    const { prisma } = await import("@cinema/database");
    const owner = await prisma.employee.findFirstOrThrow({ where: { email: `owner@${SEED_SUFFIX}` } });
    const requestId = crypto.randomUUID();
    const description = `Replay expense ${crypto.randomUUID()}`;
    const payload = { category: "OTHER", description, amountCents: 1234, incurredAt: new Date().toISOString() };
    const submit = () => request(app.getHttpServer()).post("/api/v1/reports/expenses").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send(payload);
    const [first, replay] = await Promise.all([submit(), submit()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body.id).toBe(replay.body.id);
    expect(await prisma.expense.count({ where: { locationId: owner.locationId, description } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "expense.created", entityId: first.body.id } })).toBe(1);
    const conflict = await request(app.getHttpServer()).post("/api/v1/reports/expenses").set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", requestId).send({ ...payload, amountCents: 4321 });
    expect(conflict.status).toBe(409);
    const deleteRequestId = crypto.randomUUID();
    const remove = () => request(app.getHttpServer()).delete(`/api/v1/reports/expenses/${first.body.id}`).set("Authorization", `Bearer ${ownerAccessToken}`).set("Idempotency-Key", deleteRequestId);
    const [deleted, deleteReplay] = await Promise.all([remove(), remove()]);
    expect(deleted.status).toBe(200);
    expect(deleteReplay.body).toEqual({ deleted: true });
    expect(await prisma.expense.count({ where: { id: first.body.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "expense.deleted", entityId: first.body.id } })).toBe(1);
  });

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
    const secondOrder = await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "BOX_OFFICE", status: "PAID", orderNumber: `M10-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 1800, feesCents: 100, taxCents: 100, totalCents: 2000, placedByEmployeeId: owner.id, createdAt: new Date("2024-01-12T12:00:00.000Z"), tickets: { create: { showtimeSeatId: secondShowing!.showtimeSeats[0]!.id, ticketTypeId: ticketType.id, priceCentsPaid: 1800, qrToken: `m10-${crypto.randomUUID()}` } } } });
    const [firstTicket, secondTicket] = await Promise.all([prisma.ticket.findFirstOrThrow({ where: { ticketOrderId: firstOrder.id } }), prisma.ticket.findFirstOrThrow({ where: { ticketOrderId: secondOrder.id } })]);
    const firstTab = await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "SEAT_LINKED", showtimeId: firstShowing!.id, status: "CLOSED", subtotalCents: 450, taxCents: 50, serviceChargeCents: 0, totalCents: 500, closedAt: new Date("2024-01-10T16:00:00.000Z"), seats: { create: { showtimeSeatId: firstTicket.showtimeSeatId, ticketId: firstTicket.id } } } });
    await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "SEAT_LINKED", showtimeId: secondShowing!.id, status: "CLOSED", subtotalCents: 650, taxCents: 50, serviceChargeCents: 0, totalCents: 700, closedAt: new Date("2024-01-12T16:00:00.000Z"), seats: { create: { showtimeSeatId: secondTicket.showtimeSeatId, ticketId: secondTicket.id } } } });
    await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "ONLINE", status: "REFUNDED", orderNumber: `M10-R-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 750, feesCents: 25, taxCents: 25, totalCents: 800, createdAt: new Date("2024-01-15T12:00:00.000Z") } });
    await prisma.ticketOrder.create({ data: { locationId: owner.locationId, ticketTypeId: ticketType.id, holdTokens: [], holderKey: crypto.randomUUID(), channel: "BOX_OFFICE", status: "REFUNDED", orderNumber: `M10-R-${crypto.randomUUID()}`, checkoutIdempotencyKey: crypto.randomUUID(), subtotalCents: 350, feesCents: 25, taxCents: 25, totalCents: 400, placedByEmployeeId: owner.id, createdAt: new Date("2024-01-16T12:00:00.000Z") } });
    await prisma.restaurantTab.create({ data: { locationId: owner.locationId, tabType: "WALK_IN", label: "Refunded reporting fixture", status: "REFUNDED", subtotalCents: 275, taxCents: 25, serviceChargeCents: 0, totalCents: 300, closedAt: new Date("2024-01-15T16:00:00.000Z") } });
    const menuItem = await prisma.menuItem.findFirstOrThrow({ where: { menuCategory: { locationId: owner.locationId } } });
    await prisma.restaurantOrder.create({ data: { restaurantTabId: firstTab.id, serverEmployeeId: owner.id, status: "DELIVERED", placedAt: new Date("2024-01-10T15:00:00.000Z"), items: { create: { menuItemId: menuItem.id, quantity: 2, unitPriceCentsSnapshot: menuItem.priceCents, modifierTotalCents: 50, selectedModifiers: [], kitchenStationId: menuItem.kitchenStationId, status: "SENT" } } } });

    const segment = await request(app.getHttpServer()).get(`/api/v1/reports/customer-recency?inactiveSince=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}&limit=5`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(segment.body.total).toBeGreaterThan(0);
    expect(segment.body.preview[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), email: expect.any(String), lastPurchaseAt: expect.any(String), lastOrderNumber: expect.any(String), lastOrderTotalCents: expect.any(Number) }));

    const response = await request(app.getHttpServer()).get(`/api/v1/reports/revenue?from=${period.from.toISOString()}&to=${period.to.toISOString()}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(response.body.totals).toMatchObject({ grossRevenueCents: 6766, refundedCents: 1500, ticketRefundedCents: 1200, fnbRefundedCents: 300, ticketRevenueCents: 3500, ticketFeesCents: 300, ticketTaxCents: 266, ticketCollectedCents: 4066, fnbRevenueCents: 1200, combinedRevenueCents: 5266, ticketsSold: 2, fnbOrders: 2, averageFnbSpendPerOrderCents: 600, averageFnbSpendPerSeatCents: 600, averageTotalSpendPerPatronCents: 2633, concessionAttachRatePercent: 100 });
    expect(response.body.movies).toEqual([{ movieId: movie!.id, title: movie!.title, ticketRevenueCents: 3500, ticketsSold: 2, fnbRevenueCents: 1200 }]);
    expect(response.body.showtimes.map((row: { ticketRevenueCents: number; fnbRevenueCents: number; ticketsSold: number }) => ({ ticketRevenueCents: row.ticketRevenueCents, fnbRevenueCents: row.fnbRevenueCents, ticketsSold: row.ticketsSold }))).toEqual([{ ticketRevenueCents: 1700, fnbRevenueCents: 500, ticketsSold: 1 }, { ticketRevenueCents: 1800, fnbRevenueCents: 700, ticketsSold: 1 }]);
    expect(response.body.admissionTypes).toEqual([{ ticketTypeId: ticketType.id, name: ticketType.name, ticketsSold: 2, ticketRevenueCents: 3500 }]);
    expect(response.body.salesChannels).toEqual([
      { channel: "BOX_OFFICE", ticketsSold: 1, ticketRevenueCents: 1800, grossCollectedCents: 2400, refundedCents: 400, netCollectedCents: 2000 },
      { channel: "ONLINE", ticketsSold: 1, ticketRevenueCents: 1700, grossCollectedCents: 2866, refundedCents: 800, netCollectedCents: 2066 },
    ]);
    expect(response.body.salesOperators).toEqual([{ employeeId: owner.id, employeeName: owner.name, ticketsSold: 1, grossCollectedCents: 2400, refundedCents: 400, netCollectedCents: 2000 }]);
    expect(response.body.concessionTopSellers).toEqual([{ menuItemId: menuItem.id, name: menuItem.name, unitsSold: 2, salesCents: (menuItem.priceCents + 50) * 2 }]);
    expect(response.body.dailyPerformance).toEqual([
      { date: "2024-01-10", ticketsSold: 1, ticketCollectedCents: 2066, fnbRevenueCents: 500, combinedRevenueCents: 2566, averageTotalSpendPerPatronCents: 2566 },
      { date: "2024-01-12", ticketsSold: 1, ticketCollectedCents: 2000, fnbRevenueCents: 700, combinedRevenueCents: 2700, averageTotalSpendPerPatronCents: 2700 },
    ]);
    const csv = await request(app.getHttpServer()).get(`/api/v1/reports/revenue.csv?from=${period.from.toISOString()}&to=${period.to.toISOString()}`).set("Authorization", `Bearer ${ownerAccessToken}`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attend-revenue.csv");
    expect(csv.text).toContain('"Net revenue (cents)","5266"');
    expect(csv.text).toContain('"Ticket face value (cents)","3500"');
    expect(csv.text).toContain('"Ticket fees (cents)","300"');
    expect(csv.text).toContain('"Ticket tax (cents)","266"');
    expect(csv.text).toContain('"Ticket total collected (cents)","4066"');
    expect(csv.text).toContain('"Average total spend per patron (cents)","2633"');
    expect(csv.text).toContain('"Concession attach rate (percent)","100"');
    expect(csv.text).toContain(`"${movie!.title}","2","3500","1200"`);
    expect(csv.text).toContain(`"Admission type","Tickets sold","Ticket face value (cents)"`);
    expect(csv.text).toContain(`"${ticketType.name}","2","3500"`);
    expect(csv.text).toContain('"Sales channel","Tickets sold","Ticket face value (cents)","Gross collected (cents)","Refunds (cents)","Net collected (cents)"');
    expect(csv.text).toContain('"BOX_OFFICE","1","1800","2400","400","2000"');
    expect(csv.text).toContain('"ONLINE","1","1700","2866","800","2066"');
    expect(csv.text).toContain('"Box-office operator","Tickets sold","Gross collected (cents)","Refunds (cents)","Net collected (cents)"');
    expect(csv.text).toContain(`"${owner.name}","1","2400","400","2000"`);
    expect(csv.text).toContain('"Concession item","Units sold","Sales value (cents)"');
    expect(csv.text).toContain(`"${menuItem.name}","2","${(menuItem.priceCents + 50) * 2}"`);
    expect(csv.text).toContain('"Business date","Tickets sold","Ticket collected (cents)","F&B revenue (cents)","Net revenue (cents)","Average total spend per patron (cents)"');
    expect(csv.text).toContain('"2024-01-10","1","2066","500","2566","2566"');
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
    const recoveryRequestId = crypto.randomUUID();
    const recovered = await refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: recoveryRequestId, reason: "Manager retry" });
    expect(recovered.status).toBe("REFUNDED");
    expect(recovered.payments.every((payment) => payment.status === "REFUNDED")).toBe(true);
    expect(await prisma.refund.count({ where: { paymentId: { in: tab.payments.map((payment) => payment.id) }, status: "SUCCEEDED" } })).toBe(2);
    const replayed = await refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: recoveryRequestId, reason: "Manager retry" });
    expect(replayed.id).toBe(tab.id);
    expect(await prisma.refund.count({ where: { paymentId: { in: tab.payments.map((payment) => payment.id) }, status: "SUCCEEDED" } })).toBe(2);
    await expect(refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: crypto.randomUUID(), reason: "Manager retry" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(refunds.refundRestaurant({ tabId: tab.id, locationId: owner.locationId, employeeId: owner.id, requestId: recoveryRequestId, reason: "Changed reason" })).rejects.toMatchObject({ code: "CONFLICT" });
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
