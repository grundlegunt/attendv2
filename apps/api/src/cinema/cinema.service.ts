import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { AuditActorType, Prisma, prisma } from "@cinema/database";
import { loadEnv } from "@cinema/config/env";
import type { EmailProvider } from "@cinema/notifications";
import {
  adminUiConfigSchema,
  adminUiDefaults,
  createAuditoriumRequestSchema,
  createFilmSeriesRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  duplicateShowtimeDayRequestSchema,
  moveShowtimeGroupRequestSchema,
  reorderFilmSeriesRequestSchema,
  showtimePresentationSchema,
  showtimeWindowsOverlap,
  updateMovieRequestSchema,
  duplicateAuditoriumRequestSchema,
  updateAuditoriumLayoutRequestSchema,
  updateFilmSeriesRequestSchema,
  updateShowtimeRequestSchema,
  validateAdvancedSeatLayout,
  validateSeatLayout,
  cinemaContentDefaults,
  cinemaContentSchema,
  seatMapLayoutSchema,
  dedupePublicShowtimes,
  startOfCalendarDay,
} from "@cinema/shared";
import type {
  PublicDiningMenuResponse,
  PublicShowtime,
} from "@cinema/shared";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { StructuredLogger } from "../common/logger.service";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";

type AuditoriumInput = ReturnType<typeof createAuditoriumRequestSchema.parse>;
type AuditoriumLayoutUpdateInput = ReturnType<
  typeof updateAuditoriumLayoutRequestSchema.parse
>;
type AuditoriumDuplicateInput = ReturnType<
  typeof duplicateAuditoriumRequestSchema.parse
>;
type FilmSeriesInput = ReturnType<typeof createFilmSeriesRequestSchema.parse>;
type FilmSeriesUpdateInput = ReturnType<
  typeof updateFilmSeriesRequestSchema.parse
>;
type FilmSeriesReorderInput = ReturnType<typeof reorderFilmSeriesRequestSchema.parse>;
type MovieInput = ReturnType<typeof createMovieRequestSchema.parse>;
type ShowtimeInput = ReturnType<typeof createShowtimeRequestSchema.parse>;
type DuplicateShowtimeDayInput = ReturnType<
  typeof duplicateShowtimeDayRequestSchema.parse
>;
type MovieUpdateInput = ReturnType<typeof updateMovieRequestSchema.parse>;
type ShowtimeUpdateInput = ReturnType<typeof updateShowtimeRequestSchema.parse>;
type MoveShowtimeGroupInput = ReturnType<
  typeof moveShowtimeGroupRequestSchema.parse
>;
type SchedulePlanShowtimeInput = ShowtimeInput & { priceTierId?: string };

const DUPLICATE_DAY_TRANSACTION_MAX_WAIT_MS = 10_000;
const DUPLICATE_DAY_TRANSACTION_TIMEOUT_MS = 60_000;
const PUBLISH_PLAN_TRANSACTION_MAX_WAIT_MS = 10_000;
const PUBLISH_PLAN_TRANSACTION_TIMEOUT_MS = 60_000;

function resolvedSeatingStyle(
  layoutJson: unknown,
  seats: Array<{ tableGroupId: string | null; tablePosition: "LEFT" | "RIGHT" | null }>,
) {
  const layout = seatMapLayoutSchema.safeParse(layoutJson);
  if (layout.success && layout.data.seatingStyle !== "SINGLE") return layout.data.seatingStyle;

  // Early auditorium records stored pair membership on Seat before layoutJson
  // gained seatingStyle. Preserve that intent instead of presenting a legacy
  // paired room (notably seeded Theater 1) as singles.
  const groups = new Map<string, Set<"LEFT" | "RIGHT">>();
  for (const seat of seats) {
    if (!seat.tableGroupId || !seat.tablePosition) continue;
    const positions = groups.get(seat.tableGroupId) ?? new Set<"LEFT" | "RIGHT">();
    positions.add(seat.tablePosition);
    groups.set(seat.tableGroupId, positions);
  }
  return [...groups.values()].some((positions) => positions.has("LEFT") && positions.has("RIGHT"))
    ? "PAIR" as const
    : "SINGLE" as const;
}

export function hasSameSeatLabels(
  existing: Array<{ label: string }>,
  replacement: Array<{ label: string }>,
) {
  if (existing.length !== replacement.length) return false;
  const replacementLabels = new Set(replacement.map((seat) => seat.label.toUpperCase()));
  return replacementLabels.size === replacement.length && existing.every((seat) => replacementLabels.has(seat.label.toUpperCase()));
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function privateEventPreferredDate(value: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
  const start = startOfCalendarDay(value, timeZone);
  const end = startOfCalendarDay(addIsoDays(value, 1), timeZone);
  return new Date((start.getTime() + end.getTime()) / 2);
}

export function schedulePlanWeekWindow(weekStartsAt: Date, timeZone: string) {
  const dateKey = weekStartsAt.toISOString().slice(0, 10);
  return {
    startsAt: startOfCalendarDay(dateKey, timeZone),
    endsAt: startOfCalendarDay(addIsoDays(dateKey, 7), timeZone),
  };
}

function localDateTime(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zonedDate(
  date: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour, minute, second);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localDateTime(candidate, timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate = new Date(candidate.getTime() + desired - represented);
  }
  return candidate;
}

@Injectable()
export class CinemaService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider) {}
  private async sellableSeatIds(
    tx: Prisma.TransactionClient,
    auditorium: {
      id: string;
      name: string;
      capacity: number;
      seatingMode: "RESERVED" | "GENERAL_ADMISSION";
    },
  ) {
    if (auditorium.seatingMode === "GENERAL_ADMISSION") {
      const seatMap = await tx.seatMap.upsert({
        where: { auditoriumId: auditorium.id },
        create: {
          auditoriumId: auditorium.id,
          name: `${auditorium.name} general admission inventory`,
        },
        update: {},
        select: { id: true },
      });
      const existingCount = await tx.seat.count({
        where: { seatMapId: seatMap.id },
      });
      await tx.seat.createMany({
        data: Array.from(
          { length: Math.max(0, auditorium.capacity - existingCount) },
          (_, index) => ({
            seatMapId: seatMap.id,
            label: `GA${existingCount + index + 1}`,
            rowLabel: "GA",
            number: existingCount + index + 1,
            x: existingCount + index,
            y: 0,
          }),
        ),
        skipDuplicates: true,
      });
      return tx.seat.findMany({
        where: { seatMapId: seatMap.id },
        select: { id: true },
        orderBy: [{ number: "asc" }, { createdAt: "asc" }],
        take: auditorium.capacity,
      });
    }
    return tx.seat.findMany({
      where: { seatMap: { auditoriumId: auditorium.id }, active: true },
      select: { id: true },
      orderBy: { number: "asc" },
    });
  }
  async giftCardBalance(locationId: string | undefined, code: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
          select: { organizationId: true },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
          select: { organizationId: true },
        });
    if (!location) throw AppError.notFound("Location not found.");
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const codeHash = createHash("sha256").update(normalized).digest("hex");
    const card = await prisma.giftCard.findFirst({
      where: {
        organizationId: location.organizationId,
        codeHash,
        status: "ACTIVE",
      },
      select: { codeLast4: true, balanceCents: true, currency: true },
    });
    if (!card)
      throw AppError.notFound("Gift card was not found or is inactive.");
    return card;
  }

  async createPrivateEventInquiry(
    locationId: string | undefined,
    input: {
      name?: string;
      email?: string;
      phone?: string;
      eventType?: string;
      preferredDate?: string;
      guestCount?: number;
      message?: string;
    },
    suppliedRequestId?: string,
  ) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");
    const name = input.name?.trim(),
      email = input.email?.trim().toLowerCase(),
      eventType = input.eventType?.trim(),
      message = input.message?.trim();
    if (!name || !email || !email.includes("@") || !eventType || !message)
      throw AppError.validationFailed(
        "Name, email, event type, and message are required.",
      );
    if (
      input.guestCount != null &&
      (!Number.isInteger(input.guestCount) ||
        input.guestCount < 1 ||
        input.guestCount > 5000)
    )
      throw AppError.validationFailed(
        "Guest count must be between 1 and 5000.",
      );
    const preferredDate = input.preferredDate
      ? privateEventPreferredDate(input.preferredDate, location.timezone)
      : null;
    if (preferredDate && Number.isNaN(preferredDate.getTime()))
      throw AppError.validationFailed("Preferred date is invalid.");
    const requestId = suppliedRequestId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      locationId: location.id,
      name,
      email,
      phone: input.phone?.trim() || null,
      eventType,
      preferredDate: preferredDate?.toISOString() ?? null,
      guestCount: input.guestCount ?? null,
      message,
    })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId: location.id,
          action: "private_event_inquiry.created",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const replayState = replay.afterState as { requestFingerprint?: string } | null;
        if (replayState?.requestFingerprint !== requestFingerprint)
          throw AppError.conflict("The inquiry idempotency key was already used with different details.");
        const inquiry = await tx.privateEventInquiry.findUnique({ where: { id: replay.entityId } });
        if (!inquiry) throw AppError.conflict("The original private event inquiry is no longer available.");
        return inquiry;
      }
      const inquiry = await tx.privateEventInquiry.create({
        data: {
          locationId: location.id,
          name,
          email,
          phone: input.phone?.trim() || null,
          eventType,
          preferredDate,
          guestCount: input.guestCount,
          message,
        },
      });
      await tx.auditEvent.create({ data: {
        actorType: "SYSTEM",
        locationId: location.id,
        action: "private_event_inquiry.created",
        entityType: "PrivateEventInquiry",
        entityId: inquiry.id,
        afterState: { requestId, requestFingerprint },
      } });
      return inquiry;
    });
  }
  private expiryTimer?: ReturnType<typeof setInterval>;
  private expirySweepRunning = false;
  private readonly logger = new StructuredLogger(CinemaService.name);
  private readonly minimumCinemaCleaningMinutes = 15;

  onModuleInit() {
    this.expiryTimer = setInterval(() => void this.runExpirySweep(), 15_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  private async runExpirySweep() {
    if (this.expirySweepRunning) return;
    this.expirySweepRunning = true;
    try {
      await this.expireSeatHolds();
      await this.notifyAvailableWaitlists();
    } catch (error) {
      this.logger.error("Seat-hold expiry sweep failed.", String(error));
    } finally {
      this.expirySweepRunning = false;
    }
  }

  async notifyAvailableWaitlists() {
    const now = new Date();
    await prisma.showtimeWaitlistEntry.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    const staleClaim = new Date(now.getTime() - 5 * 60_000);
    const entries = await prisma.showtimeWaitlistEntry.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: now },
        OR: [{ notificationClaimedAt: null }, { notificationClaimedAt: { lt: staleClaim } }],
        showtime: { onSale: true, startsAt: { gt: now }, showtimeSeats: { some: { blockedAt: null, tickets: { none: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { none: { releasedAt: null, expiresAt: { gt: now } } } } } },
      },
      include: { showtime: { include: { movie: true, auditorium: { include: { location: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    let notified = 0;
    for (const entry of entries) {
      const claimed = await prisma.showtimeWaitlistEntry.updateMany({ where: { id: entry.id, status: "ACTIVE", OR: [{ notificationClaimedAt: null }, { notificationClaimedAt: { lt: staleClaim } }] }, data: { notificationClaimedAt: now, notificationError: null } });
      if (!claimed.count) continue;
      try {
        const { messageId } = await this.emailProvider.sendShowtimeWaitlistAvailability({ to: entry.email, theaterName: entry.showtime.auditorium.location.name, movieTitle: entry.showtime.movie.title, startsAt: entry.showtime.startsAt, timeZone: entry.showtime.auditorium.location.timezone, purchaseUrl: `${loadEnv().CUSTOMER_WEB_URL.replace(/\/$/, "")}/showtimes?locationId=${encodeURIComponent(entry.showtime.auditorium.locationId)}` });
        await prisma.showtimeWaitlistEntry.update({ where: { id: entry.id }, data: { status: "NOTIFIED", notifiedAt: new Date(), notificationMessageId: messageId, notificationClaimedAt: null } });
        notified += 1;
      } catch (error) {
        await prisma.showtimeWaitlistEntry.updateMany({ where: { id: entry.id, status: "ACTIVE" }, data: { notificationClaimedAt: null, notificationError: error instanceof Error ? error.message.slice(0, 1000) : "Waitlist email failed." } });
      }
    }
    return notified;
  }

  private requireLocation(actor: RequestActor): string {
    if (!actor.locationId)
      throw AppError.forbidden("A location-scoped staff session is required.");
    return actor.locationId;
  }

  async adminBootstrap(actor: RequestActor) {
    const locationId = this.requireLocation(actor);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: {
        auditoriums: {
          where: { active: true },
          include: {
            seatMap: {
              include: {
                seats: {
                  where: { active: true },
                  orderBy: [{ y: "asc" }, { x: "asc" }],
                },
              },
            },
          },
          orderBy: { name: "asc" },
        },
        organization: {
          include: {
            movies: {
              where: { active: true },
              include: { pairings: { orderBy: { sortOrder: "asc" } } },
              orderBy: { title: "asc" },
            },
            filmSeries: {
              orderBy: [
                { active: "desc" },
                { sortOrder: "asc" },
                { name: "asc" },
              ],
            },
            priceTiers: {
              where: { active: true },
              orderBy: { ticketPriceMinor: "asc" },
            },
          },
        },
        menuCategories: {
          where: { active: true },
          include: {
            items: {
              where: { active: true },
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const [showtimes, archivedMovies] = await Promise.all([
      prisma.showtime.findMany({
        where: { auditorium: { locationId } },
        include: {
          movie: true,
          auditorium: true,
          priceTier: true,
          filmSeries: true,
        },
        orderBy: { startsAt: "asc" },
      }),
      prisma.movie.findMany({
        where: { organizationId: location.organizationId, active: false },
        include: { pairings: { orderBy: { sortOrder: "asc" } } },
        orderBy: { title: "asc" },
      }),
    ]);
    return { location, showtimes, archivedMovies };
  }

  async adminDashboardBootstrap(actor: RequestActor) {
    const locationId = this.requireLocation(actor);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: {
        name: true,
        timezone: true,
        auditoriums: {
          where: { active: true },
          select: { id: true, name: true, capacity: true, seatMap: { select: { id: true } } },
          orderBy: { name: "asc" },
        },
        organization: {
          select: {
            movies: { where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" } },
            filmSeries: { select: { id: true, name: true, active: true }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] },
          },
        },
      },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const showtimes = await prisma.showtime.findMany({
      where: { auditorium: { locationId } },
      select: {
        id: true,
        startsAt: true,
        onSale: true,
        movie: { select: { id: true, title: true } },
        auditorium: { select: { id: true, name: true, capacity: true } },
      },
      orderBy: { startsAt: "asc" },
    });
    return { location, showtimes };
  }

  adminDeliveryReadiness(actor: RequestActor) {
    this.requireLocation(actor);
    const env = loadEnv();
    return {
      email: { ready: env.EMAIL_PROVIDER === "postmark", provider: env.EMAIL_PROVIDER },
      sms: { ready: env.SMS_PROVIDER === "twilio", provider: env.SMS_PROVIDER },
      appleWallet: { ready: env.APPLE_WALLET_PROVIDER === "passkit", provider: env.APPLE_WALLET_PROVIDER },
      googleWallet: { ready: env.GOOGLE_WALLET_PROVIDER === "google", provider: env.GOOGLE_WALLET_PROVIDER },
    };
  }

  async schedulePlans(actor: RequestActor) {
    return prisma.schedulePlan.findMany({
      where: { locationId: this.requireLocation(actor) },
      select: {
        id: true,
        name: true,
        weekStartsAt: true,
        createdAt: true,
        snapshotJson: true,
      },
      orderBy: [{ weekStartsAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async createSchedulePlan(
    actor: RequestActor,
    input: { name: string; weekStartsAt: string },
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, ...input }))
      .digest("hex");
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const weekStartsAt = new Date(input.weekStartsAt);
    const weekWindow = schedulePlanWeekWindow(weekStartsAt, location.timezone);
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "schedule_plan.created",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The schedule-plan idempotency key was already used with different details.",
            );
          }
          const plan = await tx.schedulePlan.findFirst({
            where: { id: replay.entityId, locationId },
            select: {
              id: true,
              name: true,
              weekStartsAt: true,
              createdAt: true,
              snapshotJson: true,
            },
          });
          if (!plan) {
            throw AppError.conflict("The original schedule plan is no longer available.");
          }
          return plan;
        }
        const showtimes = await tx.showtime.findMany({
          where: {
            auditorium: { locationId },
            startsAt: { gte: weekWindow.startsAt, lt: weekWindow.endsAt },
          },
          select: {
            movieId: true,
            auditoriumId: true,
            priceTierId: true,
            startsAt: true,
            onSale: true,
            filmSeriesId: true,
            presentation: true,
            format: true,
          },
          orderBy: { startsAt: "asc" },
        });
        const snapshot = showtimes.map((showtime) => ({
          ...showtime,
          startsAt: showtime.startsAt.toISOString(),
        }));
        const plan = await tx.schedulePlan.create({
          data: {
            locationId,
            name: input.name,
            weekStartsAt,
            snapshotJson: snapshot,
          },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "schedule_plan.created",
            entityType: "SchedulePlan",
            entityId: plan.id,
            locationId,
            afterState: {
              name: plan.name,
              weekStartsAt: plan.weekStartsAt.toISOString(),
              showtimeCount: showtimes.length,
              requestId,
              requestFingerprint,
            },
          },
        });
        return plan;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "A schedule plan already uses that name for this week.",
        );
      throw error;
    }
  }

  async validateSchedulePlan(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    const plan = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
    });
    if (!plan) throw AppError.notFound("Schedule plan not found.");
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: {
        auditoriums: {
          where: { active: true },
          select: {
            id: true,
            capacity: true,
            seatingMode: true,
            seatMap: {
              select: {
                seats: {
                  where: { active: true },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
        organization: {
          select: {
            movies: {
              where: { active: true },
              select: { id: true, title: true, runtimeMinutes: true },
            },
            priceTiers: { where: { active: true }, select: { id: true } },
            filmSeries: { where: { active: true }, select: { id: true } },
          },
        },
      },
    });
    if (!location) throw AppError.notFound("Location not found.");

    const issues: Array<{ index: number; message: string }> = [];
    const rawSnapshot = Array.isArray(plan.snapshotJson)
      ? plan.snapshotJson
      : [];
    const weekWindow = schedulePlanWeekWindow(plan.weekStartsAt, location.timezone);
    const auditoriumIds = new Set(
      location.auditoriums.map((auditorium) => auditorium.id),
    );
    const sellableAuditoriumIds = new Set(
      location.auditoriums
        .filter(
          (auditorium) =>
            (auditorium.seatingMode === "GENERAL_ADMISSION" &&
              auditorium.capacity > 0) ||
            Boolean(auditorium.seatMap?.seats.length),
        )
        .map((auditorium) => auditorium.id),
    );
    const movies = new Map(
      location.organization.movies.map((movie) => [movie.id, movie]),
    );
    const priceTierIds = new Set(
      location.organization.priceTiers.map((tier) => tier.id),
    );
    const filmSeriesIds = new Set(
      location.organization.filmSeries.map((series) => series.id),
    );
    const showtimes: Array<
      SchedulePlanShowtimeInput & {
        index: number;
        startsAtDate: Date;
        roomReadyAt: Date;
      }
    > = [];

    rawSnapshot.forEach((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        issues.push({ index, message: "Saved showing data is invalid." });
        return;
      }
      const normalized = { ...raw } as Record<string, unknown>;
      if (normalized.priceTierId === null) delete normalized.priceTierId;
      const parsed = createShowtimeRequestSchema.safeParse(normalized);
      if (!parsed.success) {
        issues.push({
          index,
          message: "Saved showing data is incomplete or invalid.",
        });
        return;
      }
      const startsAtDate = new Date(parsed.data.startsAt);
      if (startsAtDate < weekWindow.startsAt || startsAtDate >= weekWindow.endsAt)
        issues.push({ index, message: "Showing falls outside the plan week." });
      const movie = movies.get(parsed.data.movieId);
      if (!movie)
        issues.push({ index, message: "Film is no longer available." });
      if (!auditoriumIds.has(parsed.data.auditoriumId))
        issues.push({ index, message: "Auditorium is no longer available." });
      else if (!sellableAuditoriumIds.has(parsed.data.auditoriumId))
        issues.push({
          index,
          message: "Auditorium has no sellable ticket inventory.",
        });
      if (parsed.data.priceTierId && !priceTierIds.has(parsed.data.priceTierId))
        issues.push({ index, message: "Ticket tier is no longer available." });
      if (
        parsed.data.filmSeriesId &&
        !filmSeriesIds.has(parsed.data.filmSeriesId)
      )
        issues.push({ index, message: "Film series is no longer available." });
      if (!movie || !auditoriumIds.has(parsed.data.auditoriumId)) return;
      const roomReadyAt = new Date(
        startsAtDate.getTime() +
          (location.preShowBufferMinutes +
            movie.runtimeMinutes +
            Math.max(
              this.minimumCinemaCleaningMinutes,
              location.cleaningBufferMinutes,
            )) *
            60_000,
      );
      showtimes.push({ ...parsed.data, index, startsAtDate, roomReadyAt });
    });

    for (let left = 0; left < showtimes.length; left += 1) {
      for (let right = left + 1; right < showtimes.length; right += 1) {
        const first = showtimes[left]!,
          second = showtimes[right]!;
        if (first.auditoriumId !== second.auditoriumId) continue;
        if (
          !showtimeWindowsOverlap(
            { startsAt: first.startsAtDate, roomReadyAt: first.roomReadyAt },
            { startsAt: second.startsAtDate, roomReadyAt: second.roomReadyAt },
          )
        )
          continue;
        issues.push({
          index: first.index,
          message: `Conflicts with saved showing ${second.index + 1}.`,
        });
        issues.push({
          index: second.index,
          message: `Conflicts with saved showing ${first.index + 1}.`,
        });
      }
    }

    return {
      valid: issues.length === 0,
      showtimeCount: rawSnapshot.length,
      issues,
      expectedUpdatedAt: plan.updatedAt.toISOString(),
    };
  }

  async publishSchedulePlan(
    actor: RequestActor,
    id: string,
    expectedUpdatedAtValue: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        locationId,
        planId: id,
        expectedUpdatedAt: expectedUpdatedAtValue,
      }))
      .digest("hex");
    const replayResult = (afterState: unknown) => {
      const state = afterState as {
        requestFingerprint?: string;
        preservedCount?: number;
        createdCount?: number;
        removedCount?: number;
      } | null;
      if (state?.requestFingerprint !== requestFingerprint) {
        throw AppError.conflict(
          "The schedule-plan publish key was already used with different details.",
        );
      }
      if (
        typeof state.preservedCount !== "number" ||
        typeof state.createdCount !== "number" ||
        typeof state.removedCount !== "number"
      ) {
        throw AppError.conflict("The original publish result is unavailable.");
      }
      return {
        published: true,
        preservedCount: state.preservedCount,
        createdCount: state.createdCount,
        removedCount: state.removedCount,
      };
    };
    const findReplay = () => prisma.auditEvent.findFirst({
      where: {
        locationId,
        action: "schedule_plan.published",
        afterState: { path: ["requestId"], equals: requestId },
      },
    });
    const existingReplay = await findReplay();
    if (existingReplay) return replayResult(existingReplay.afterState);
    const validation = await this.validateSchedulePlan(actor, id);
    if (!validation.valid)
      throw AppError.conflict(
        "Resolve every saved-plan issue before publishing.",
        { issues: validation.issues },
      );
    const expectedUpdatedAt = new Date(expectedUpdatedAtValue);
    if (validation.expectedUpdatedAt !== expectedUpdatedAt.toISOString()) {
      const completedReplay = await findReplay();
      if (completedReplay) return replayResult(completedReplay.afterState);
      throw AppError.conflict(
        "This plan changed after it was checked. Check it again before publishing.",
      );
    }

    const publishAttempt = () => prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "schedule_plan.published",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) return replayResult(replay.afterState);
        const plan = await tx.schedulePlan.findFirst({
          where: { id, locationId, updatedAt: expectedUpdatedAt },
        });
        if (!plan)
          throw AppError.conflict(
            "This plan changed after it was checked. Check it again before publishing.",
          );
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: {
            organizationId: true,
            timezone: true,
            preShowBufferMinutes: true,
            cleaningBufferMinutes: true,
          },
        });
        if (!location) throw AppError.notFound("Location not found.");
        const weekWindow = schedulePlanWeekWindow(
          plan.weekStartsAt,
          location.timezone,
        );
        if (weekWindow.startsAt <= new Date())
          throw AppError.conflict(
            "Only a future schedule week can be published from a saved plan.",
          );
        const snapshot = plan.snapshotJson as Array<Record<string, unknown>>;
        const parsed = snapshot.map((raw) => {
          const normalized = { ...raw };
          if (normalized.priceTierId === null) delete normalized.priceTierId;
          return createShowtimeRequestSchema.parse(normalized);
        });
        const auditoriumIds = [
          ...new Set(parsed.map((showtime) => showtime.auditoriumId)),
        ].sort();
        for (const auditoriumId of auditoriumIds)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditoriumId}))`;
        const auditoriums = new Map(
          (
            await tx.auditorium.findMany({
              where: { id: { in: auditoriumIds }, locationId, active: true },
            })
          ).map((auditorium) => [auditorium.id, auditorium]),
        );

        const movies = new Map(
          (
            await tx.movie.findMany({
              where: {
                id: { in: parsed.map((showtime) => showtime.movieId) },
                organizationId: location.organizationId,
                active: true,
              },
            })
          ).map((movie) => [movie.id, movie]),
        );
        const desired = [];
        for (const showtime of parsed) {
          const movie = movies.get(showtime.movieId);
          if (!movie)
            throw AppError.conflict(
              "A film in this plan is no longer available. Check the plan again.",
            );
          const startsAt = new Date(showtime.startsAt);
          const priceTier = await this.resolvePriceTier(
            tx,
            location.organizationId,
            location.timezone,
            startsAt,
            showtime.priceTierId,
          );
          const featureStartsAt = new Date(
            startsAt.getTime() + location.preShowBufferMinutes * 60_000,
          );
          const endsAt = new Date(
            featureStartsAt.getTime() + movie.runtimeMinutes * 60_000,
          );
          const roomReadyAt = new Date(
            endsAt.getTime() +
              Math.max(
                this.minimumCinemaCleaningMinutes,
                location.cleaningBufferMinutes,
              ) *
                60_000,
          );
          desired.push({
            ...showtime,
            priceTierId: priceTier.id,
            startsAt,
            featureStartsAt,
            endsAt,
            roomReadyAt,
          });
        }

        const live = await tx.showtime.findMany({
          where: {
            auditorium: { locationId },
            startsAt: { gte: weekWindow.startsAt, lt: weekWindow.endsAt },
          },
        });
        const key = (showtime: {
          movieId: string;
          auditoriumId: string;
          priceTierId: string;
          startsAt: Date;
          onSale: boolean;
          filmSeriesId: string | null;
          presentation: string;
          format: string | null;
        }) =>
          JSON.stringify([
            showtime.movieId,
            showtime.auditoriumId,
            showtime.priceTierId,
            showtime.startsAt.toISOString(),
            showtime.onSale,
            showtime.filmSeriesId,
            showtime.presentation,
            showtime.format,
          ]);
        const desiredKeys = new Set(
          desired.map((showtime) =>
            key({
              ...showtime,
              filmSeriesId: showtime.filmSeriesId ?? null,
              format: showtime.format ?? null,
            }),
          ),
        );
        const liveKeys = new Set(live.map(key));
        const remove = live.filter(
          (showtime) => !desiredKeys.has(key(showtime)),
        );
        const create = desired.filter(
          (showtime) =>
            !liveKeys.has(
              key({
                ...showtime,
                filmSeriesId: showtime.filmSeriesId ?? null,
                format: showtime.format ?? null,
              }),
            ),
        );
        const removeIds = remove.map((showtime) => showtime.id);
        if (removeIds.length) {
          const now = new Date();
          const [tickets, restaurantTabs, restaurantOrders, activeSeatHolds] =
            await Promise.all([
              tx.ticket.count({
                where: { showtimeSeat: { showtimeId: { in: removeIds } } },
              }),
              tx.restaurantTab.count({
                where: { showtimeId: { in: removeIds } },
              }),
              tx.restaurantOrder.count({
                where: { showtimeSeat: { showtimeId: { in: removeIds } } },
              }),
              tx.seatHold.count({
                where: {
                  showtimeSeat: { showtimeId: { in: removeIds } },
                  releasedAt: null,
                  expiresAt: { gt: now },
                },
              }),
            ]);
          if (tickets || restaurantTabs || restaurantOrders || activeSeatHolds)
            throw AppError.conflict(
              "Publishing would replace a live showing with tickets, restaurant activity, or active seat holds. Resolve those records first.",
              { tickets, restaurantTabs, restaurantOrders, activeSeatHolds },
            );
          await tx.showtime.deleteMany({ where: { id: { in: removeIds } } });
        }

        const seatsByAuditorium = new Map<string, Array<{ id: string }>>();
        for (const showtime of create) {
          const created = await tx.showtime.create({
            data: {
              movieId: showtime.movieId,
              auditoriumId: showtime.auditoriumId,
              priceTierId: showtime.priceTierId,
              startsAt: showtime.startsAt,
              featureStartsAt: showtime.featureStartsAt,
              endsAt: showtime.endsAt,
              roomReadyAt: showtime.roomReadyAt,
              onSale: showtime.onSale,
              filmSeriesId: showtime.filmSeriesId ?? null,
              presentation: showtime.presentation,
              format: showtime.format ?? null,
            },
          });
          const auditorium = auditoriums.get(showtime.auditoriumId);
          if (!auditorium)
            throw AppError.conflict(
              "An auditorium in this plan is no longer available. Check the plan again.",
            );
          let seats = seatsByAuditorium.get(showtime.auditoriumId);
          if (!seats) {
            seats = await this.sellableSeatIds(tx, auditorium);
            seatsByAuditorium.set(showtime.auditoriumId, seats);
          }
          if (!seats.length)
            throw AppError.conflict(
              "An auditorium in this plan no longer has an active seat layout. Check the plan again.",
            );
          await tx.showtimeSeat.createMany({
            data: seats.map((seat) => ({
              showtimeId: created.id,
              seatId: seat.id,
            })),
          });
        }
        await tx.schedulePlan.update({
          where: { id: plan.id },
          data: { snapshotJson: plan.snapshotJson as Prisma.InputJsonValue },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "schedule_plan.published",
            entityType: "SchedulePlan",
            entityId: plan.id,
            locationId,
            afterState: {
              name: plan.name,
              weekStartsAt: plan.weekStartsAt.toISOString(),
              preservedCount: live.length - remove.length,
              createdCount: create.length,
              removedCount: remove.length,
              requestId,
              requestFingerprint,
            },
          },
        });
        return {
          published: true,
          preservedCount: live.length - remove.length,
          createdCount: create.length,
          removedCount: remove.length,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: PUBLISH_PLAN_TRANSACTION_MAX_WAIT_MS,
        timeout: PUBLISH_PLAN_TRANSACTION_TIMEOUT_MS,
      },
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await publishAttempt();
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt === 0
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2002" || error.code === "P2034")
        )
          throw AppError.conflict(
            "The live schedule changed while this plan was publishing. Check the plan and try again.",
          );
        throw error;
      }
    }
    throw AppError.conflict(
      "The live schedule changed while this plan was publishing. Check the plan and try again.",
    );
  }

  async deleteSchedulePlan(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, planId: id }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "schedule_plan.deleted",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The schedule-plan deletion key was already used for another plan.",
          );
        }
        return { deleted: true };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const plan = await tx.schedulePlan.findFirst({
        where: { id, locationId },
        select: { id: true, name: true, weekStartsAt: true },
      });
      if (!plan) throw AppError.notFound("Schedule plan not found.");
      await tx.schedulePlan.delete({ where: { id: plan.id } });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "schedule_plan.deleted",
          entityType: "SchedulePlan",
          entityId: plan.id,
          locationId,
          beforeState: {
            name: plan.name,
            weekStartsAt: plan.weekStartsAt.toISOString(),
          },
          afterState: { requestId, requestFingerprint },
        },
      });
      return { deleted: true };
    });
  }

  async duplicateSchedulePlan(
    actor: RequestActor,
    id: string,
    name: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, sourcePlanId: id, name }))
      .digest("hex");
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "schedule_plan.duplicated",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The schedule-plan duplication key was already used with different details.",
            );
          }
          const plan = await tx.schedulePlan.findFirst({
            where: { id: replay.entityId, locationId },
            select: {
              id: true,
              name: true,
              weekStartsAt: true,
              createdAt: true,
              snapshotJson: true,
            },
          });
          if (!plan) {
            throw AppError.conflict("The original duplicated plan is no longer available.");
          }
          return plan;
        }
        const source = await tx.schedulePlan.findFirst({
          where: { id, locationId },
        });
        if (!source) throw AppError.notFound("Schedule plan not found.");
        const plan = await tx.schedulePlan.create({
          data: {
            locationId,
            name,
            weekStartsAt: source.weekStartsAt,
            snapshotJson: source.snapshotJson as Prisma.InputJsonValue,
          },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "schedule_plan.duplicated",
            entityType: "SchedulePlan",
            entityId: plan.id,
            locationId,
            afterState: {
              name: plan.name,
              weekStartsAt: plan.weekStartsAt.toISOString(),
              sourcePlanId: source.id,
              requestId,
              requestFingerprint,
            },
          },
        });
        return plan;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "A schedule plan already uses that name for this week.",
        );
      throw error;
    }
  }

  async addSchedulePlanShowtime(
    actor: RequestActor,
    id: string,
    input: ShowtimeInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, planId: id, ...input }))
      .digest("hex");
    const [plan, location] = await Promise.all([
      prisma.schedulePlan.findFirst({ where: { id, locationId } }),
      prisma.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true, timezone: true },
      }),
    ]);
    if (!plan || !location) throw AppError.notFound("Schedule plan not found.");
    const startsAt = new Date(input.startsAt);
    const weekWindow = schedulePlanWeekWindow(plan.weekStartsAt, location.timezone);
    if (startsAt < weekWindow.startsAt || startsAt >= weekWindow.endsAt)
      throw AppError.validationFailed(
        "The showing must stay within this plan's week.",
      );
    const [movie, auditorium, priceTier, filmSeries] = await Promise.all([
      prisma.movie.findFirst({
        where: {
          id: input.movieId,
          organizationId: location.organizationId,
          active: true,
        },
        select: { id: true },
      }),
      prisma.auditorium.findFirst({
        where: { id: input.auditoriumId, locationId, active: true },
        select: { id: true },
      }),
      input.priceTierId
        ? prisma.priceTier.findFirst({
            where: {
              id: input.priceTierId,
              organizationId: location.organizationId,
              active: true,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      input.filmSeriesId
        ? prisma.filmSeries.findFirst({
            where: {
              id: input.filmSeriesId,
              organizationId: location.organizationId,
              active: true,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (
      !movie ||
      !auditorium ||
      (input.priceTierId && !priceTier) ||
      (input.filmSeriesId && !filmSeries)
    )
      throw AppError.validationFailed(
        "The saved showing contains an unavailable film, auditorium, price tier, or series.",
      );
    const showtime = {
      movieId: input.movieId,
      auditoriumId: input.auditoriumId,
      priceTierId: input.priceTierId ?? null,
      startsAt: startsAt.toISOString(),
      onSale: input.onSale,
      filmSeriesId: input.filmSeriesId ?? null,
      presentation: input.presentation,
      format: input.format ?? null,
    };
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "schedule_plan.showtime_added",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The saved-showing idempotency key was already used with different details.",
          );
        }
        const replayedPlan = await tx.schedulePlan.findFirst({
          where: { id: replay.entityId, locationId },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        if (!replayedPlan) {
          throw AppError.conflict("The original saved plan is no longer available.");
        }
        return replayedPlan;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const currentPlan = await tx.schedulePlan.findFirst({
        where: { id, locationId },
      });
      if (!currentPlan) throw AppError.notFound("Schedule plan not found.");
      const snapshot = Array.isArray(currentPlan.snapshotJson)
        ? [...currentPlan.snapshotJson]
        : [];
      snapshot.push(showtime);
      snapshot.sort((left, right) =>
        String((left as { startsAt?: unknown }).startsAt ?? "").localeCompare(
          String((right as { startsAt?: unknown }).startsAt ?? ""),
        ),
      );
      const saved = await tx.schedulePlan.update({
        where: { id: currentPlan.id },
        data: { snapshotJson: snapshot as Prisma.InputJsonValue },
        select: {
          id: true,
          name: true,
          weekStartsAt: true,
          createdAt: true,
          snapshotJson: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "schedule_plan.showtime_added",
          entityType: "SchedulePlan",
          entityId: currentPlan.id,
          locationId,
          afterState: {
            showtime,
            showtimeCount: snapshot.length,
            requestId,
            requestFingerprint,
          },
        },
      });
      return saved;
    });
  }

  async renameSchedulePlan(
    actor: RequestActor,
    id: string,
    name: string,
    expectedName: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, planId: id, name, expectedName }))
      .digest("hex");
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "schedule_plan.renamed",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The schedule-plan rename key was already used with different details.",
            );
          }
          const replayedPlan = await tx.schedulePlan.findFirst({
            where: { id: replay.entityId, locationId },
            select: {
              id: true,
              name: true,
              weekStartsAt: true,
              createdAt: true,
              snapshotJson: true,
            },
          });
          if (!replayedPlan) {
            throw AppError.conflict("The original saved plan is no longer available.");
          }
          return replayedPlan;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const plan = await tx.schedulePlan.findFirst({
          where: { id, locationId },
          select: { id: true, name: true },
        });
        if (!plan) throw AppError.notFound("Schedule plan not found.");
        if (plan.name !== expectedName) {
          throw AppError.conflict(
            "This schedule plan was renamed elsewhere. Refresh before renaming it again.",
          );
        }
        const updated = await tx.schedulePlan.update({
          where: { id: plan.id },
          data: { name },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "schedule_plan.renamed",
            entityType: "SchedulePlan",
            entityId: plan.id,
            locationId,
            beforeState: { name: plan.name },
            afterState: {
              name: updated.name,
              requestId,
              requestFingerprint,
            },
          },
        });
        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw AppError.conflict(
          "A schedule plan already uses that name for this week.",
        );
      throw error;
    }
  }

  async removeSchedulePlanShowtime(
    actor: RequestActor,
    id: string,
    index: number,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!Number.isInteger(index) || index < 0) {
      throw AppError.validationFailed("Saved showtime not found in this plan.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, planId: id, index }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "schedule_plan.showtime_removed",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The saved-showing removal key was already used with different details.",
          );
        }
        const replayedPlan = await tx.schedulePlan.findFirst({
          where: { id: replay.entityId, locationId },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        if (!replayedPlan) {
          throw AppError.conflict("The original saved plan is no longer available.");
        }
        return replayedPlan;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const plan = await tx.schedulePlan.findFirst({
        where: { id, locationId },
      });
      if (!plan) throw AppError.notFound("Schedule plan not found.");
      const snapshot = Array.isArray(plan.snapshotJson)
        ? [...plan.snapshotJson]
        : [];
      if (index >= snapshot.length) {
        throw AppError.validationFailed("Saved showtime not found in this plan.");
      }
      const [removed] = snapshot.splice(index, 1);
      const saved = await tx.schedulePlan.update({
        where: { id: plan.id },
        data: { snapshotJson: snapshot as Prisma.InputJsonValue },
        select: {
          id: true,
          name: true,
          weekStartsAt: true,
          createdAt: true,
          snapshotJson: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "schedule_plan.showtime_removed",
          entityType: "SchedulePlan",
          entityId: plan.id,
          locationId,
          beforeState: {
            showtime: removed as Prisma.InputJsonValue,
            showtimeIndex: index,
          },
          afterState: {
            showtimeCount: snapshot.length,
            requestId,
            requestFingerprint,
          },
        },
      });
      return saved;
    });
  }

  async updateSchedulePlanShowtime(
    actor: RequestActor,
    id: string,
    index: number,
    startsAtValue: string,
    expectedStartsAtValue: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!Number.isInteger(index) || index < 0) {
      throw AppError.validationFailed("Saved showtime not found in this plan.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const startsAt = new Date(startsAtValue);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        locationId,
        planId: id,
        index,
        startsAt: startsAtValue,
        expectedStartsAt: expectedStartsAtValue,
      }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "schedule_plan.showtime_updated",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The saved-showing update key was already used with different details.",
          );
        }
        const replayedPlan = await tx.schedulePlan.findFirst({
          where: { id: replay.entityId, locationId },
          select: {
            id: true,
            name: true,
            weekStartsAt: true,
            createdAt: true,
            snapshotJson: true,
          },
        });
        if (!replayedPlan) {
          throw AppError.conflict("The original saved plan is no longer available.");
        }
        return replayedPlan;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const plan = await tx.schedulePlan.findFirst({
        where: { id, locationId },
      });
      if (!plan) throw AppError.notFound("Schedule plan not found.");
      const snapshot = Array.isArray(plan.snapshotJson)
        ? [...plan.snapshotJson]
        : [];
      if (index >= snapshot.length) {
        throw AppError.validationFailed("Saved showtime not found in this plan.");
      }
      const weekWindow = schedulePlanWeekWindow(plan.weekStartsAt, location.timezone);
      if (startsAt < weekWindow.startsAt || startsAt >= weekWindow.endsAt) {
        throw AppError.validationFailed(
          "The showing must stay within this plan's week.",
        );
      }
      const existing = snapshot[index];
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        throw AppError.validationFailed("The saved showtime is invalid.");
      }
      if ((existing as { startsAt?: unknown }).startsAt !== expectedStartsAtValue) {
        throw AppError.conflict(
          "This saved showing changed. Refresh the plan before changing its time.",
        );
      }
      const changed = { ...existing, startsAt: startsAt.toISOString() };
      snapshot[index] = changed;
      const saved = await tx.schedulePlan.update({
        where: { id: plan.id },
        data: { snapshotJson: snapshot as Prisma.InputJsonValue },
        select: {
          id: true,
          name: true,
          weekStartsAt: true,
          createdAt: true,
          snapshotJson: true,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "schedule_plan.showtime_updated",
          entityType: "SchedulePlan",
          entityId: plan.id,
          locationId,
          beforeState: {
            showtime: existing as Prisma.InputJsonValue,
            showtimeIndex: index,
          },
          afterState: {
            showtime: changed as Prisma.InputJsonValue,
            showtimeIndex: index,
            requestId,
            requestFingerprint,
          },
        },
      });
      return saved;
    });
  }

  async createAuditorium(
    actor: RequestActor,
    input: AuditoriumInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const reservedSeats = input.seats ?? [];
    const layoutErrors =
      input.seatingMode === "RESERVED"
        ? input.layout
          ? validateAdvancedSeatLayout(reservedSeats, input.layout)
          : validateSeatLayout(reservedSeats)
        : [];
    if (layoutErrors.length) {
      throw AppError.validationFailed("The seat layout is invalid.", {
        errors: layoutErrors,
      });
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, input }))
      .digest("hex");

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "auditorium.created",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The auditorium idempotency key was already used with different details.",
            );
          }
          const auditorium = await tx.auditorium.findFirst({
            where: { id: replay.entityId, locationId },
            include: { seatMap: { include: { seats: true } } },
          });
          if (!auditorium) throw AppError.conflict("The original auditorium is no longer available.");
          return auditorium;
        }
        const auditorium = await tx.auditorium.create({
          data: {
            locationId,
            name: input.name,
            capacity:
              input.seatingMode === "GENERAL_ADMISSION"
                ? input.capacity!
                : reservedSeats.length,
            seatingMode: input.seatingMode,
            ...(input.seatingMode === "RESERVED"
              ? {
                  seatMap: {
                    create: {
                      name: input.seatMapName!,
                      layoutJson: input.layout as
                        Prisma.InputJsonValue | undefined,
                      revisions: {
                        create: {
                          version: 1,
                          layoutJson: input.layout as
                            Prisma.InputJsonValue | undefined,
                        },
                      },
                      seats: {
                        create: reservedSeats.map((seat) => ({
                          ...seat,
                          label: seat.label.toUpperCase(),
                          rowLabel: seat.rowLabel.toUpperCase(),
                          tableGroupId: seat.tableGroupId ?? null,
                          tablePosition: seat.tablePosition ?? null,
                          levelKey: seat.levelKey ?? null,
                          sectionKey: seat.sectionKey ?? null,
                        })),
                      },
                    },
                  },
                }
              : {}),
          },
          include: { seatMap: { include: { seats: true } } },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "auditorium.created",
            entityType: "Auditorium",
            entityId: auditorium.id,
            locationId,
            afterState: {
              name: auditorium.name,
              capacity: auditorium.capacity,
              seatingMode: auditorium.seatingMode,
              requestId,
              requestFingerprint,
            },
          },
        });
        return auditorium;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppError.conflict(
          "An auditorium or seat already uses that name, label, or coordinate.",
        );
      }
      throw error;
    }
  }

  async updateAuditoriumLayout(
    actor: RequestActor,
    id: string,
    input: AuditoriumLayoutUpdateInput,
    requestId: string = randomUUID(),
    expectedVersionValue?: string,
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const expectedVersion = expectedVersionValue === undefined
      ? null
      : Number(expectedVersionValue);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
      throw AppError.validationFailed("The auditorium layout version is invalid.");
    }
    const reservedSeats = input.seats ?? [];
    const layoutErrors =
      input.seatingMode === "GENERAL_ADMISSION"
        ? []
        : validateAdvancedSeatLayout(reservedSeats, input.layout!);
    if (layoutErrors.length)
      throw AppError.validationFailed("The seat layout is invalid.", {
        errors: layoutErrors,
      });
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, auditoriumId: id, input, expectedVersion }))
      .digest("hex");

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: {
              in: [
                "auditorium.layout_version_created",
                "auditorium.general_admission_configured",
              ],
            },
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The auditorium-layout key was already used with different details.",
            );
          }
          const updated = await tx.auditorium.findFirst({
            where: { id: replay.entityId, locationId, active: true },
            include: {
              seatMap: {
                include: {
                  seats: {
                    where: { active: true },
                    orderBy: [{ y: "asc" }, { x: "asc" }],
                  },
                },
              },
            },
          });
          if (!updated) throw AppError.conflict("The updated auditorium is no longer available.");
          return updated;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const auditorium = await tx.auditorium.findFirst({
          where: { id, locationId, active: true },
          include: { seatMap: true },
        });
        if (!auditorium) throw AppError.notFound("Auditorium not found.");
        if (input.seatingMode === "GENERAL_ADMISSION") {
          const updated = await tx.auditorium.update({
            where: { id },
            data: {
              name: input.name ?? auditorium.name,
              capacity: input.capacity!,
              seatingMode: "GENERAL_ADMISSION",
            },
            include: {
              seatMap: {
                include: {
                  seats: {
                    where: { active: true },
                    orderBy: [{ y: "asc" }, { x: "asc" }],
                  },
                },
              },
            },
          });
          await tx.auditEvent.create({
            data: {
              actorType: AuditActorType.EMPLOYEE,
              actorId: actor.sub,
              locationId,
              action: "auditorium.general_admission_configured",
              entityType: "Auditorium",
              entityId: id,
              beforeState: {
                capacity: auditorium.capacity,
                seatingMode: auditorium.seatingMode,
              },
              afterState: {
                capacity: updated.capacity,
                seatingMode: updated.seatingMode,
                requestId,
                requestFingerprint,
              },
            },
          });
          return updated;
        }
        const seatMap =
          auditorium.seatMap ??
          (await tx.seatMap.create({
            data: {
              auditoriumId: id,
              name:
                input.seatMapName ?? `${input.name ?? auditorium.name} layout`,
              version: 0,
            },
          }));
        const beforeVersion = seatMap.version;
        if (expectedVersion !== null && beforeVersion !== expectedVersion) {
          throw AppError.conflict(
            "This auditorium layout changed in another session. Refresh before saving again.",
          );
        }
        const nextVersion = beforeVersion + 1;
        await tx.seat.updateMany({
          where: { seatMapId: seatMap.id, active: true },
          data: { active: false },
        });
        await tx.seatMap.update({
          where: { id: seatMap.id },
          data: {
            name: input.seatMapName ?? seatMap.name,
            version: nextVersion,
            layoutJson: input.layout as Prisma.InputJsonValue,
            revisions: {
              create: {
                version: nextVersion,
                layoutJson: input.layout as Prisma.InputJsonValue,
              },
            },
            seats: {
              create: reservedSeats.map((seat) => ({
                label: seat.label.toUpperCase(),
                rowLabel: seat.rowLabel.toUpperCase(),
                number: seat.number,
                x: seat.x,
                y: seat.y,
                type: seat.type,
                layoutVersion: nextVersion,
                tableGroupId: seat.tableGroupId ?? null,
                tablePosition: seat.tablePosition ?? null,
                levelKey: seat.levelKey ?? null,
                sectionKey: seat.sectionKey ?? null,
              })),
            },
          },
        });
        const updated = await tx.auditorium.update({
          where: { id },
          data: {
            name: input.name ?? auditorium.name,
            capacity: reservedSeats.length,
            seatingMode: "RESERVED",
          },
          include: {
            seatMap: {
              include: {
                seats: {
                  where: { active: true },
                  orderBy: [{ y: "asc" }, { x: "asc" }],
                },
              },
            },
          },
        });
        const futureShowtimes = input.applyToFutureShowtimes
          ? await tx.showtime.findMany({
              where: { auditoriumId: id, startsAt: { gte: new Date() } },
              select: { id: true, showtimeSeats: { select: { seatId: true, seat: { select: { label: true } } } } },
            })
          : [];
        const replacementSeats = updated.seatMap?.seats ?? [];
        const eligibleShowtimes = futureShowtimes.filter((showtime) => hasSameSeatLabels(showtime.showtimeSeats.map((inventory) => inventory.seat), replacementSeats));
        const replacementByLabel = new Map(replacementSeats.map((seat) => [seat.label.toUpperCase(), seat.id]));
        const seatReplacements = new Map<string, string>();
        for (const showtime of eligibleShowtimes) {
          for (const inventory of showtime.showtimeSeats) {
            const replacementId = replacementByLabel.get(inventory.seat.label.toUpperCase());
            if (replacementId && replacementId !== inventory.seatId) seatReplacements.set(inventory.seatId, replacementId);
          }
        }
        if (eligibleShowtimes.length && seatReplacements.size) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "showtime_seats" AS inventory
            SET "seatId" = replacements."newSeatId", "updatedAt" = NOW()
            FROM (VALUES ${Prisma.join([...seatReplacements].map(([oldSeatId, newSeatId]) => Prisma.sql`(${oldSeatId}::text, ${newSeatId}::text)`))}) AS replacements("oldSeatId", "newSeatId")
            WHERE inventory."seatId" = replacements."oldSeatId"
              AND inventory."showtimeId" IN (${Prisma.join(eligibleShowtimes.map((showtime) => showtime.id))})
          `);
        }
        const layoutPropagation = {
          updatedShowtimes: eligibleShowtimes.length,
          skippedShowtimes: futureShowtimes.length - eligibleShowtimes.length,
        };
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            locationId,
            action: "auditorium.layout_version_created",
            entityType: "Auditorium",
            entityId: id,
            beforeState: {
              version: beforeVersion,
              capacity: auditorium.capacity,
            },
            afterState: {
              version: nextVersion,
              capacity: reservedSeats.length,
              mode: input.layout!.mode,
              seatingMode: "RESERVED",
              layoutPropagation,
              requestId,
              requestFingerprint,
            },
          },
        });
        return { ...updated, layoutPropagation };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppError.conflict(
          "A seat already uses that label or coordinate in this layout version.",
        );
      }
      throw error;
    }
  }

  async duplicateAuditorium(
    actor: RequestActor,
    id: string,
    input: AuditoriumDuplicateInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, sourceAuditoriumId: id, input }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "auditorium.duplicated",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The auditorium-duplication key was already used with different details.",
          );
        }
        const copy = await tx.auditorium.findFirst({
          where: { id: replay.entityId, locationId },
          include: { seatMap: { include: { seats: true } } },
        });
        if (!copy) throw AppError.conflict("The duplicated auditorium is no longer available.");
        return copy;
      }
      const source = await tx.auditorium.findFirst({
        where: { id, locationId, active: true },
        include: {
          seatMap: { include: { seats: { where: { active: true } } } },
        },
      });
      if (!source) throw AppError.notFound("Auditorium not found.");
      const copy = await tx.auditorium.create({
        data: {
          locationId,
          name: input.name,
          capacity: source.capacity,
          seatingMode: source.seatingMode,
          ...(source.seatingMode === "RESERVED" && source.seatMap
            ? {
                seatMap: {
                  create: {
                    name: `${input.name} layout`,
                    version: 1,
                    layoutJson: source.seatMap.layoutJson ?? undefined,
                    revisions: {
                      create: {
                        version: 1,
                        layoutJson: source.seatMap.layoutJson ?? undefined,
                      },
                    },
                    seats: {
                      create: source.seatMap.seats.map((seat) => ({
                        label: seat.label,
                        rowLabel: seat.rowLabel,
                        number: seat.number,
                        x: seat.x,
                        y: seat.y,
                        type: seat.type,
                        tableGroupId: seat.tableGroupId,
                        tablePosition: seat.tablePosition,
                        levelKey: seat.levelKey,
                        sectionKey: seat.sectionKey,
                      })),
                    },
                  },
                },
              }
            : {}),
        },
        include: { seatMap: { include: { seats: true } } },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "auditorium.duplicated",
          entityType: "Auditorium",
          entityId: copy.id,
          afterState: {
            sourceAuditoriumId: source.id,
            name: copy.name,
            capacity: copy.capacity,
            requestId,
            requestFingerprint,
          },
        },
      });
      return copy;
    });
  }

  async deactivateAuditorium(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "auditorium.deactivated",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const deactivated = await tx.auditorium.findFirst({
          where: { id: replay.entityId, locationId, active: false },
        });
        if (!deactivated) {
          throw AppError.conflict("The original auditorium deactivation can no longer be replayed.");
        }
        return deactivated;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const auditorium = await tx.auditorium.findFirst({
        where: { id, locationId, active: true },
      });
      if (!auditorium) throw AppError.notFound("Auditorium not found.");
      const futureShowtimes = await tx.showtime.count({
        where: { auditoriumId: id, startsAt: { gte: new Date() } },
      });
      if (futureShowtimes) {
        throw AppError.conflict(
          `Remove or move ${futureShowtimes} future showtime${futureShowtimes === 1 ? "" : "s"} before deactivating this auditorium.`,
        );
      }
      const deactivated = await tx.auditorium.update({
        where: { id },
        data: { active: false },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "auditorium.deactivated",
          entityType: "Auditorium",
          entityId: id,
          beforeState: {
            active: true,
            name: auditorium.name,
            capacity: auditorium.capacity,
          },
          afterState: { active: false, requestId },
        },
      });
      return deactivated;
    });
  }

  async createMovie(
    actor: RequestActor,
    input: MovieInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, input }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "movie.created",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The movie idempotency key was already used with different details.",
          );
        }
        const movie = await tx.movie.findFirst({
          where: { id: replay.entityId, organizationId: location.organizationId },
        });
        if (!movie) throw AppError.conflict("The original movie is no longer available.");
        return movie;
      }
      await this.validatePairingMenuItems(
        tx,
        locationId,
        input.pairingMenuItemIds,
      );
      const movie = await tx.movie.create({
        data: {
          organizationId: location.organizationId,
          title: input.title,
          synopsis: input.synopsis ?? null,
          runtimeMinutes: input.runtimeMinutes,
          rating: input.rating ?? null,
          posterUrl: input.posterUrl ?? null,
          detailPosterUrl: input.detailPosterUrl ?? null,
          posterPosition: input.posterPosition,
          detailPosterPosition: input.detailPosterPosition,
          diningSpecialArtworkUrl: input.diningSpecialArtworkUrl ?? null,
          diningSpecialTitle: input.diningSpecialTitle ?? null,
          director: input.director ?? null,
          starring: input.starring ?? null,
          trailerUrl: input.trailerUrl ?? null,
          releaseYear: input.releaseYear ?? null,
          distributorName: input.distributorName ?? null,
          distributorTerms: input.distributorTerms as Prisma.InputJsonValue,
          pairings: {
            create: input.pairingMenuItemIds.map((menuItemId, sortOrder) => ({
              menuItemId,
              sortOrder,
            })),
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.created",
          entityType: "Movie",
          entityId: movie.id,
          locationId,
          afterState: {
            title: movie.title,
            runtimeMinutes: movie.runtimeMinutes,
            rating: movie.rating,
            posterUrl: movie.posterUrl,
            detailPosterUrl: movie.detailPosterUrl,
            posterPosition: movie.posterPosition,
            detailPosterPosition: movie.detailPosterPosition,
            diningSpecialArtworkUrl: movie.diningSpecialArtworkUrl,
            diningSpecialTitle: movie.diningSpecialTitle,
            director: movie.director,
            starring: movie.starring,
            trailerUrl: movie.trailerUrl,
            releaseYear: movie.releaseYear,
            distributorName: movie.distributorName,
            distributorTerms: movie.distributorTerms,
            pairingMenuItemIds: input.pairingMenuItemIds,
            requestId,
            requestFingerprint,
          },
        },
      });
      return movie;
    });
  }

  async filmCatalog(actor: RequestActor, query?: string) {
    const locationId = this.requireLocation(actor);
    const location = await prisma.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
    if (!location) throw AppError.notFound("Location not found.");
    const search = query?.trim().slice(0, 200);
    const entries = await prisma.filmCatalogEntry.findMany({
      where: {
        active: true,
        ...(search ? { OR: [
          { title: { contains: search, mode: "insensitive" } },
          { director: { contains: search, mode: "insensitive" } },
          { starring: { contains: search, mode: "insensitive" } },
          { primaryDistributorName: { contains: search, mode: "insensitive" } },
          { imdbId: { equals: search, mode: "insensitive" } },
          { eidrId: { equals: search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: [{ verified: "desc" }, { title: "asc" }, { releaseYear: "desc" }],
      take: 50,
      include: { operatorMovies: { where: { organizationId: location.organizationId }, select: { id: true } } },
    });
    return { entries: entries.map(({ operatorMovies, ...entry }) => ({
      ...entry,
      importedMovieId: operatorMovies[0]?.id ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })) };
  }

  async importCatalogMovie(actor: RequestActor, catalogEntryId: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
      if (!location) throw AppError.notFound("Location not found.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${location.organizationId}:${catalogEntryId}`}))`;
      const catalog = await tx.filmCatalogEntry.findFirst({ where: { id: catalogEntryId, active: true } });
      if (!catalog) throw AppError.notFound("Catalog film not found.");
      const existing = await tx.movie.findFirst({ where: { organizationId: location.organizationId, catalogEntryId } });
      if (existing) throw AppError.conflict("This film is already in the cinema library.");
      const movie = await tx.movie.create({ data: {
        organizationId: location.organizationId,
        catalogEntryId: catalog.id,
        title: catalog.title,
        synopsis: catalog.synopsis,
        runtimeMinutes: catalog.runtimeMinutes,
        rating: catalog.rating,
        posterUrl: catalog.posterUrl,
        detailPosterUrl: catalog.detailPosterUrl,
        director: catalog.director,
        starring: catalog.starring,
        trailerUrl: catalog.trailerUrl,
        releaseYear: catalog.releaseYear,
        distributorName: catalog.primaryDistributorName,
        distributorTerms: [],
      } });
      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE,
        actorId: actor.sub,
        locationId,
        action: "movie.catalog_imported",
        entityType: "Movie",
        entityId: movie.id,
        afterState: { catalogEntryId: catalog.id, title: movie.title },
      } });
      return movie;
    });
  }

  async archiveMovie(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "movie.archived",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const archived = await tx.movie.findFirst({
          where: {
            id: replay.entityId,
            organizationId: location.organizationId,
            active: false,
          },
        });
        if (!archived) throw AppError.conflict("The archived movie is no longer available.");
        return archived;
      }
      const movie = await tx.movie.findFirst({
        where: { id, organizationId: location.organizationId, active: true },
      });
      if (!movie) throw AppError.notFound("Movie not found.");
      const futureShowtimes = await tx.showtime.count({
        where: { movieId: id, startsAt: { gte: new Date() } },
      });
      if (futureShowtimes) {
        throw AppError.conflict(
          `Remove ${futureShowtimes} future showtime${futureShowtimes === 1 ? "" : "s"} before removing this film from the library.`,
        );
      }
      const archived = await tx.movie.update({
        where: { id },
        data: { active: false },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.archived",
          entityType: "Movie",
          entityId: movie.id,
          locationId,
          beforeState: {
            active: true,
            title: movie.title,
            runtimeMinutes: movie.runtimeMinutes,
          },
          afterState: { active: false, requestId },
        },
      });
      return archived;
    });
  }

  async restoreMovie(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "movie.restored",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const restored = await tx.movie.findFirst({
          where: {
            id: replay.entityId,
            organizationId: location.organizationId,
            active: true,
          },
        });
        if (!restored) throw AppError.conflict("The restored movie is no longer available.");
        return restored;
      }
      const movie = await tx.movie.findFirst({
        where: { id, organizationId: location.organizationId, active: false },
      });
      if (!movie) throw AppError.notFound("Archived movie not found.");
      const restored = await tx.movie.update({
        where: { id },
        data: { active: true },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.restored",
          entityType: "Movie",
          entityId: movie.id,
          locationId,
          beforeState: { active: false, title: movie.title },
          afterState: { active: true, requestId },
        },
      });
      return restored;
    });
  }

  async permanentlyDeleteMovie(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "movie.deleted",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) return { deleted: true, id: replay.entityId };
      const movie = await tx.movie.findFirst({
        where: { id, organizationId: location.organizationId, active: false },
      });
      if (!movie) throw AppError.notFound("Archived movie not found.");
      const showtimeCount = await tx.showtime.count({ where: { movieId: id } });
      if (showtimeCount) {
        throw AppError.conflict(
          "This film has showtime or sales history and cannot be permanently deleted. Keep it archived to preserve reporting records.",
        );
      }
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.deleted",
          entityType: "Movie",
          entityId: movie.id,
          locationId,
          beforeState: {
            active: false,
            title: movie.title,
            runtimeMinutes: movie.runtimeMinutes,
          },
          afterState: { deleted: true, requestId },
        },
      });
      await tx.movie.delete({ where: { id } });
      return { deleted: true, id };
    });
  }

  async updateMovie(
    actor: RequestActor,
    id: string,
    input: MovieUpdateInput,
    requestId: string = randomUUID(),
    expectedUpdatedAtValue?: string,
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const expectedUpdatedAt = expectedUpdatedAtValue
      ? new Date(expectedUpdatedAtValue)
      : null;
    if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
      throw AppError.validationFailed("The movie version is invalid.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        locationId,
        movieId: id,
        input,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null,
      }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "movie.updated",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The movie-update key was already used with different details.",
          );
        }
        const movie = await tx.movie.findFirst({
          where: { id: replay.entityId, organizationId: location.organizationId },
        });
        if (!movie) throw AppError.conflict("The updated movie is no longer available.");
        return movie;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const existing = await tx.movie.findFirst({
        where: { id, organizationId: location.organizationId, active: true },
      });
      if (!existing) throw AppError.notFound("Movie not found.");
      if (
        expectedUpdatedAt &&
        existing.updatedAt.toISOString() !== expectedUpdatedAt.toISOString()
      ) {
        throw AppError.conflict(
          "This movie changed in another session. Refresh before saving again.",
        );
      }
      const { pairingMenuItemIds, distributorTerms, ...movieFields } = input;
      if (pairingMenuItemIds)
        await this.validatePairingMenuItems(tx, locationId, pairingMenuItemIds);
      const movie = await tx.movie.update({
        where: { id },
        data: {
          ...movieFields,
          ...(distributorTerms
            ? { distributorTerms: distributorTerms as Prisma.InputJsonValue }
            : {}),
          ...(pairingMenuItemIds
            ? {
                pairings: {
                  deleteMany: {},
                  create: pairingMenuItemIds.map((menuItemId, sortOrder) => ({
                    menuItemId,
                    sortOrder,
                  })),
                },
              }
            : {}),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.updated",
          entityType: "Movie",
          entityId: movie.id,
          locationId,
          beforeState: {
            title: existing.title,
            synopsis: existing.synopsis,
            runtimeMinutes: existing.runtimeMinutes,
            rating: existing.rating,
            posterUrl: existing.posterUrl,
            detailPosterUrl: existing.detailPosterUrl,
            posterPosition: existing.posterPosition,
            detailPosterPosition: existing.detailPosterPosition,
            diningSpecialArtworkUrl: existing.diningSpecialArtworkUrl,
            diningSpecialTitle: existing.diningSpecialTitle,
            director: existing.director,
            starring: existing.starring,
            trailerUrl: existing.trailerUrl,
            releaseYear: existing.releaseYear,
            distributorName: existing.distributorName,
            distributorTerms: existing.distributorTerms,
          },
          afterState: {
            title: movie.title,
            synopsis: movie.synopsis,
            runtimeMinutes: movie.runtimeMinutes,
            rating: movie.rating,
            posterUrl: movie.posterUrl,
            detailPosterUrl: movie.detailPosterUrl,
            posterPosition: movie.posterPosition,
            detailPosterPosition: movie.detailPosterPosition,
            diningSpecialArtworkUrl: movie.diningSpecialArtworkUrl,
            diningSpecialTitle: movie.diningSpecialTitle,
            director: movie.director,
            starring: movie.starring,
            trailerUrl: movie.trailerUrl,
            releaseYear: movie.releaseYear,
            distributorName: movie.distributorName,
            distributorTerms: movie.distributorTerms,
            ...(pairingMenuItemIds ? { pairingMenuItemIds } : {}),
            requestId,
            requestFingerprint,
          },
        },
      });
      return movie;
    });
  }

  private async validatePairingMenuItems(
    tx: Prisma.TransactionClient,
    locationId: string,
    menuItemIds: string[],
  ) {
    if (!menuItemIds.length) return;
    if (new Set(menuItemIds).size !== menuItemIds.length) {
      throw AppError.validationFailed("A menu item can only be paired once.");
    }
    const count = await tx.menuItem.count({
      where: {
        id: { in: menuItemIds },
        active: true,
        menuCategory: { locationId },
      },
    });
    if (count !== menuItemIds.length)
      throw AppError.notFound("One or more pairing menu items were not found.");
  }

  async createFilmSeries(
    actor: RequestActor,
    input: FilmSeriesInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, input }))
      .digest("hex");
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { organizationId: true },
        });
        if (!location) throw AppError.notFound("Location not found.");
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "film_series.created",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The film series idempotency key was already used with different details.",
            );
          }
          const filmSeries = await tx.filmSeries.findFirst({
            where: { id: replay.entityId, organizationId: location.organizationId },
          });
          if (!filmSeries) throw AppError.conflict("The original film series is no longer available.");
          return filmSeries;
        }
        const filmSeries = await tx.filmSeries.create({
          data: {
            organizationId: location.organizationId,
            name: input.name,
            description: input.description ?? null,
            artworkUrl: input.artworkUrl ?? null,
            sortOrder:
              input.sortOrder ??
              (await tx.filmSeries.count({
                where: {
                  organizationId: location.organizationId,
                  active: true,
                },
              })),
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            locationId,
            action: "film_series.created",
            entityType: "FilmSeries",
            entityId: filmSeries.id,
            afterState: {
              name: filmSeries.name,
              active: filmSeries.active,
              requestId,
              requestFingerprint,
            },
          },
        });
        return filmSeries;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppError.conflict("A film series already uses that name.");
      }
      throw error;
    }
  }

  async updateFilmSeries(
    actor: RequestActor,
    id: string,
    input: FilmSeriesUpdateInput,
    requestId: string = randomUUID(),
    expectedUpdatedAtValue?: string,
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const expectedUpdatedAt = expectedUpdatedAtValue
      ? new Date(expectedUpdatedAtValue)
      : null;
    if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
      throw AppError.validationFailed("The film series version is invalid.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        locationId,
        filmSeriesId: id,
        input,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null,
      }))
      .digest("hex");
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { organizationId: true },
        });
        if (!location) throw AppError.notFound("Location not found.");
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "film_series.updated",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The film-series update key was already used with different details.",
            );
          }
          const filmSeries = await tx.filmSeries.findFirst({
            where: { id: replay.entityId, organizationId: location.organizationId },
          });
          if (!filmSeries) throw AppError.conflict("The updated film series is no longer available.");
          return filmSeries;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const existing = await tx.filmSeries.findFirst({
          where: { id, organizationId: location.organizationId },
        });
        if (!existing) throw AppError.notFound("Film series not found.");
        if (
          expectedUpdatedAt &&
          existing.updatedAt.toISOString() !== expectedUpdatedAt.toISOString()
        ) {
          throw AppError.conflict(
            "This film series changed in another session. Refresh before saving again.",
          );
        }
        const filmSeries = await tx.filmSeries.update({
          where: { id },
          data: input,
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            locationId,
            action: "film_series.updated",
            entityType: "FilmSeries",
            entityId: filmSeries.id,
            beforeState: {
              name: existing.name,
              description: existing.description,
              artworkUrl: existing.artworkUrl,
              sortOrder: existing.sortOrder,
              active: existing.active,
            },
            afterState: {
              name: filmSeries.name,
              description: filmSeries.description,
              artworkUrl: filmSeries.artworkUrl,
              sortOrder: filmSeries.sortOrder,
              active: filmSeries.active,
              requestId,
              requestFingerprint,
            },
          },
        });
        return filmSeries;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppError.conflict("A film series already uses that name.");
      }
      throw error;
    }
  }

  async archiveFilmSeries(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "film_series.archived",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const archived = await tx.filmSeries.findFirst({
          where: {
            id: replay.entityId,
            organizationId: location.organizationId,
            active: false,
          },
        });
        if (!archived) throw AppError.conflict("The archived film series is no longer available.");
        return archived;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const existing = await tx.filmSeries.findFirst({
        where: { id, organizationId: location.organizationId, active: true },
      });
      if (!existing) throw AppError.notFound("Film series not found.");
      const archived = await tx.filmSeries.update({
        where: { id },
        data: { active: false },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "film_series.archived",
          entityType: "FilmSeries",
          entityId: id,
          beforeState: { name: existing.name, active: true },
          afterState: { name: archived.name, active: false, requestId },
        },
      });
      return archived;
    });
  }

  async restoreFilmSeries(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "film_series.restored",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const restored = await tx.filmSeries.findFirst({
          where: {
            id: replay.entityId,
            organizationId: location.organizationId,
            active: true,
          },
        });
        if (!restored) throw AppError.conflict("The restored film series is no longer available.");
        return restored;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const existing = await tx.filmSeries.findFirst({
        where: { id, organizationId: location.organizationId, active: false },
      });
      if (!existing) throw AppError.notFound("Archived film series not found.");
      const restored = await tx.filmSeries.update({
        where: { id },
        data: { active: true },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "film_series.restored",
          entityType: "FilmSeries",
          entityId: id,
          beforeState: { name: existing.name, active: false },
          afterState: { name: restored.name, active: true, requestId },
        },
      });
      return restored;
    });
  }

  async reorderFilmSeries(
    actor: RequestActor,
    input: FilmSeriesReorderInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, seriesIds: input.seriesIds }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "film_series.reordered",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The film-series reorder key was already used with a different order.",
          );
        }
        return { reordered: true };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${location.organizationId}))`;
      const activeSeries = await tx.filmSeries.findMany({
        where: { organizationId: location.organizationId, active: true },
        select: { id: true },
      });
      const activeIds = new Set(activeSeries.map((series) => series.id));
      if (
        activeIds.size !== input.seriesIds.length ||
        input.seriesIds.some((id) => !activeIds.has(id))
      ) {
        throw AppError.conflict(
          "The Film Series catalog changed. Refresh before reordering it.",
        );
      }
      await Promise.all(input.seriesIds.map((id, sortOrder) =>
        tx.filmSeries.update({ where: { id }, data: { sortOrder } }),
      ));
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "film_series.reordered",
          entityType: "FilmSeriesOrder",
          entityId: location.organizationId,
          afterState: {
            seriesIds: input.seriesIds,
            requestId,
            requestFingerprint,
          },
        },
      });
      return { reordered: true };
    });
  }

  async createShowtime(actor: RequestActor, input: ShowtimeInput, requestId: string = randomUUID()) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId, movieId: input.movieId, auditoriumId: input.auditoriumId, priceTierId: input.priceTierId ?? null, startsAt: input.startsAt, onSale: input.onSale, filmSeriesId: input.filmSeriesId ?? null, presentation: input.presentation, format: input.format ?? null })).digest("hex");
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({ where: { locationId, action: "showtime.created", afterState: { path: ["requestId"], equals: requestId } } });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The showtime idempotency key was already used with different details.");
          const showtime = await tx.showtime.findUnique({ where: { id: replay.entityId }, include: { movie: true, auditorium: true, priceTier: true, filmSeries: true } });
          if (!showtime) throw AppError.conflict("The original showtime is no longer available.");
          return showtime;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.auditoriumId}))`;
        const auditorium = await tx.auditorium.findFirst({
          where: { id: input.auditoriumId, locationId, active: true },
          include: { location: true },
        });
        if (!auditorium) throw AppError.notFound("Auditorium not found.");
        if (!auditorium.capacity)
          throw AppError.conflict("Auditorium must have sellable capacity.");

        const movie = await tx.movie.findFirst({
          where: {
            id: input.movieId,
            organizationId: auditorium.location.organizationId,
            active: true,
          },
        });
        if (!movie) throw AppError.notFound("Movie not found.");

        const filmSeries = input.filmSeriesId
          ? await tx.filmSeries.findFirst({
              where: {
                id: input.filmSeriesId,
                organizationId: auditorium.location.organizationId,
                active: true,
              },
            })
          : null;
        if (input.filmSeriesId && !filmSeries)
          throw AppError.notFound("Film series not found.");

        const startsAt = new Date(input.startsAt);
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(
          featureStartsAt.getTime() + movie.runtimeMinutes * 60000,
        );
        const cleaningMinutes = Math.max(
          this.minimumCinemaCleaningMinutes,
          auditorium.location.cleaningBufferMinutes,
        );
        const roomReadyAt = new Date(
          endsAt.getTime() + cleaningMinutes * 60000,
        );
        const priceTier = await this.resolvePriceTier(
          tx,
          auditorium.location.organizationId,
          auditorium.location.timezone,
          startsAt,
          input.priceTierId,
        );

        const conflict = await tx.showtime.findFirst({
          where: {
            auditoriumId: auditorium.id,
            startsAt: { lt: roomReadyAt },
            roomReadyAt: { gt: startsAt },
          },
          include: { movie: true },
        });
        if (conflict) {
          throw AppError.conflict(
            `Conflicts with ${conflict.movie.title} at ${conflict.startsAt.toISOString()}.`,
            {
              conflictingShowtimeId: conflict.id,
              roomReadyAt: conflict.roomReadyAt.toISOString(),
            },
          );
        }

        const showtime = await tx.showtime.create({
          data: {
            movieId: movie.id,
            auditoriumId: auditorium.id,
            priceTierId: priceTier.id,
            startsAt,
            featureStartsAt,
            endsAt,
            roomReadyAt,
            onSale: input.onSale,
            filmSeriesId: filmSeries?.id ?? null,
            presentation: input.presentation,
            format: input.format ?? null,
          },
          include: {
            movie: true,
            auditorium: true,
            priceTier: true,
            filmSeries: true,
          },
        });
        const seats = await this.sellableSeatIds(tx, auditorium);
        await tx.showtimeSeat.createMany({
          data: seats.map((seat) => ({
            showtimeId: showtime.id,
            seatId: seat.id,
          })),
          skipDuplicates: true,
        });
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "showtime.created",
            entityType: "Showtime",
            entityId: showtime.id,
            locationId,
            afterState: {
              requestId,
              requestFingerprint,
              movieId: movie.id,
              auditoriumId: auditorium.id,
              startsAt: startsAt.toISOString(),
              roomReadyAt: roomReadyAt.toISOString(),
              onSale: input.onSale,
              filmSeriesId: filmSeries?.id ?? null,
              presentation: input.presentation,
              format: input.format ?? null,
            },
          },
        });
        return showtime;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  async duplicateShowtimeDay(
    actor: RequestActor,
    input: DuplicateShowtimeDayInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          locationId,
          sourceDate: input.sourceDate,
          targetDates: input.targetDates,
          saleStatus: input.saleStatus,
        }),
      )
      .digest("hex");
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        timezone: true,
        preShowBufferMinutes: true,
        cleaningBufferMinutes: true,
      },
    });
    if (!location) throw AppError.notFound("Location not found.");

    const sourceStart = zonedDate(input.sourceDate, 0, 0, 0, location.timezone);
    const sourceEnd = zonedDate(
      addIsoDays(input.sourceDate, 1),
      0,
      0,
      0,
      location.timezone,
    );
    const sourceShowtimes = await prisma.showtime.findMany({
      where: {
        auditorium: { locationId, active: true },
        startsAt: { gte: sourceStart, lt: sourceEnd },
      },
      include: {
        movie: true,
        auditorium: true,
        priceTier: true,
        filmSeries: true,
      },
      orderBy: { startsAt: "asc" },
    });
    if (!sourceShowtimes.length)
      throw AppError.validationFailed(
        "The source day has no showtimes to duplicate.",
      );

    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "showtime.day_duplicated",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as {
            requestFingerprint?: string;
            showtimeIds?: string[];
          } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The duplicate-day idempotency key was already used with different details.",
            );
          }
          const showtimeIds = state.showtimeIds ?? [];
          const showtimes = await tx.showtime.findMany({
            where: { id: { in: showtimeIds } },
            include: {
              movie: true,
              auditorium: true,
              priceTier: true,
              filmSeries: true,
            },
          });
          const showtimeById = new Map(
            showtimes.map((showtime) => [showtime.id, showtime]),
          );
          const orderedShowtimes = showtimeIds
            .map((id) => showtimeById.get(id))
            .filter((showtime): showtime is NonNullable<typeof showtime> => Boolean(showtime));
          if (orderedShowtimes.length !== showtimeIds.length) {
            throw AppError.conflict(
              "One or more showtimes from the original duplicate-day request are no longer available.",
            );
          }
          return {
            createdCount: orderedShowtimes.length,
            showtimes: orderedShowtimes,
          };
        }
        const auditoriumIds = Array.from(
          new Set(sourceShowtimes.map((showtime) => showtime.auditoriumId)),
        ).sort();
        for (const auditoriumId of auditoriumIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditoriumId}))`;
        }
        const seatsByAuditorium = new Map<string, Array<{ id: string }>>();
        const created = [];
        for (const targetDate of input.targetDates) {
          for (const source of sourceShowtimes) {
            const sourceLocal = localDateTime(
              source.startsAt,
              location.timezone,
            );
            const startsAt = zonedDate(
              targetDate,
              sourceLocal.hour,
              sourceLocal.minute,
              sourceLocal.second,
              location.timezone,
            );
            const featureStartsAt = new Date(
              startsAt.getTime() + location.preShowBufferMinutes * 60000,
            );
            const endsAt = new Date(
              featureStartsAt.getTime() + source.movie.runtimeMinutes * 60000,
            );
            const cleaningMinutes = Math.max(
              this.minimumCinemaCleaningMinutes,
              location.cleaningBufferMinutes,
            );
            const roomReadyAt = new Date(
              endsAt.getTime() + cleaningMinutes * 60000,
            );
            const conflict = await tx.showtime.findFirst({
              where: {
                auditoriumId: source.auditoriumId,
                startsAt: { lt: roomReadyAt },
                roomReadyAt: { gt: startsAt },
              },
              include: { movie: true },
            });
            if (conflict) {
              throw AppError.conflict(
                `${source.auditorium.name} already has ${conflict.movie.title} overlapping ${startsAt.toISOString()}. No showtimes were copied.`,
              );
            }
            const onSale =
              input.saleStatus === "ON_SALE"
                ? true
                : input.saleStatus === "DRAFT"
                  ? false
                  : source.onSale;
            const showtime = await tx.showtime.create({
              data: {
                movieId: source.movieId,
                auditoriumId: source.auditoriumId,
                priceTierId: source.priceTierId,
                startsAt,
                featureStartsAt,
                endsAt,
                roomReadyAt,
                onSale,
                filmSeriesId: source.filmSeriesId,
                presentation: source.presentation,
                format: source.format,
              },
              include: {
                movie: true,
                auditorium: true,
                priceTier: true,
                filmSeries: true,
              },
            });
            let seats = seatsByAuditorium.get(source.auditoriumId);
            if (!seats) {
              seats = await this.sellableSeatIds(tx, source.auditorium);
              seatsByAuditorium.set(source.auditoriumId, seats);
            }
            await tx.showtimeSeat.createMany({
              data: seats.map((seat) => ({
                showtimeId: showtime.id,
                seatId: seat.id,
              })),
              skipDuplicates: true,
            });
            created.push(showtime);
          }
        }
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "showtime.day_duplicated",
            entityType: "Location",
            entityId: locationId,
            locationId,
            afterState: {
              sourceDate: input.sourceDate,
              targetDates: input.targetDates,
              createdCount: created.length,
              saleStatus: input.saleStatus,
              requestId,
              requestFingerprint,
              showtimeIds: created.map((showtime) => showtime.id),
            },
          },
        });
        return { createdCount: created.length, showtimes: created };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: DUPLICATE_DAY_TRANSACTION_MAX_WAIT_MS,
        timeout: DUPLICATE_DAY_TRANSACTION_TIMEOUT_MS,
      },
    );
  }

  async bulkUpdateShowtimes(
    actor: RequestActor,
    input: {
      showtimes: Array<{ id: string; expectedUpdatedAt: string }>;
      onSale?: boolean;
      priceTierId?: string;
    },
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requested = [...input.showtimes].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(requested.map((showtime) => showtime.id)).size !== requested.length) {
      throw AppError.validationFailed("Each showtime may only be selected once.");
    }
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      locationId,
      showtimes: requested,
      onSale: input.onSale ?? null,
      priceTierId: input.priceTierId ?? null,
    })).digest("hex");
    const updateAttempt = () => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "showtime.bulk_updated",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string; showtimeIds?: string[] } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict("The bulk-update key was already used with different changes.");
        }
        return tx.showtime.findMany({
          where: { id: { in: state.showtimeIds ?? [] }, auditorium: { locationId } },
          include: { movie: true, auditorium: true, priceTier: true, filmSeries: true },
          orderBy: { startsAt: "asc" },
        });
      }
      for (const showtime of requested) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${showtime.id}))`;
      }
      const existing = await tx.showtime.findMany({
        where: { id: { in: requested.map((showtime) => showtime.id) }, auditorium: { locationId } },
        include: { auditorium: { include: { location: true } } },
      });
      if (existing.length !== requested.length) throw AppError.notFound("One or more selected showtimes were not found.");
      const expectedById = new Map(requested.map((showtime) => [showtime.id, showtime.expectedUpdatedAt]));
      if (existing.some((showtime) => showtime.updatedAt.toISOString() !== expectedById.get(showtime.id))) {
        throw AppError.conflict("One or more selected showtimes changed in another session. Refresh before applying bulk changes.");
      }
      if (input.priceTierId) {
        const organizationIds = new Set(existing.map((showtime) => showtime.auditorium.location.organizationId));
        if (organizationIds.size !== 1) throw AppError.conflict("Selected showtimes must belong to one organization.");
        const priceTier = await tx.priceTier.findFirst({
          where: { id: input.priceTierId, organizationId: [...organizationIds][0], active: true },
          select: { id: true },
        });
        if (!priceTier) throw AppError.notFound("Ticket group not found.");
      }
      await tx.showtime.updateMany({
        where: { id: { in: requested.map((showtime) => showtime.id) }, auditorium: { locationId } },
        data: {
          ...(input.onSale === undefined ? {} : { onSale: input.onSale }),
          ...(input.priceTierId === undefined ? {} : { priceTierId: input.priceTierId }),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "showtime.bulk_updated",
          entityType: "ShowtimeBatch",
          entityId: requestId,
          beforeState: {
            showtimes: existing.map((showtime) => ({ id: showtime.id, onSale: showtime.onSale, priceTierId: showtime.priceTierId })),
          },
          afterState: {
            showtimeIds: requested.map((showtime) => showtime.id),
            onSale: input.onSale ?? null,
            priceTierId: input.priceTierId ?? null,
            requestId,
            requestFingerprint,
          },
        },
      });
      return tx.showtime.findMany({
        where: { id: { in: requested.map((showtime) => showtime.id) }, auditorium: { locationId } },
        include: { movie: true, auditorium: true, priceTier: true, filmSeries: true },
        orderBy: { startsAt: "asc" },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await updateAttempt();
      } catch (error) {
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!serializationFailure || attempt === 2) throw error;
      }
    }
    throw AppError.conflict(
      "The bulk showtime update could not be completed. Try again.",
    );
  }

  async updateShowtime(
    actor: RequestActor,
    id: string,
    input: ShowtimeUpdateInput,
    requestId: string = randomUUID(),
    expectedUpdatedAtValue?: string,
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const expectedUpdatedAt = expectedUpdatedAtValue
      ? new Date(expectedUpdatedAtValue)
      : null;
    if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
      throw AppError.validationFailed("The showtime version is invalid.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        locationId,
        showtimeId: id,
        input,
        expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null,
      }))
      .digest("hex");
    const updateAttempt = () => prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "showtime.updated",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The showtime-update key was already used with different details.",
            );
          }
          const replayedShowtime = await tx.showtime.findFirst({
            where: { id: replay.entityId, auditorium: { locationId } },
            include: {
              movie: true,
              auditorium: true,
              priceTier: true,
              filmSeries: true,
            },
          });
          if (!replayedShowtime) {
            throw AppError.conflict("The updated showtime is no longer available.");
          }
          return replayedShowtime;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const existing = await tx.showtime.findFirst({
          where: { id, auditorium: { locationId } },
        });
        if (!existing) throw AppError.notFound("Showtime not found.");
        if (
          expectedUpdatedAt &&
          existing.updatedAt.toISOString() !== expectedUpdatedAt.toISOString()
        ) {
          throw AppError.conflict(
            "This showtime changed in another session. Refresh before saving again.",
          );
        }

        const auditoriumId = input.auditoriumId ?? existing.auditoriumId;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditoriumId}))`;
        const auditorium = await tx.auditorium.findFirst({
          where: { id: auditoriumId, locationId, active: true },
          include: { location: true },
        });
        if (!auditorium) throw AppError.notFound("Auditorium not found.");

        const movieId = input.movieId ?? existing.movieId;
        const movie = await tx.movie.findFirst({
          where: {
            id: movieId,
            organizationId: auditorium.location.organizationId,
            active: true,
          },
        });
        if (!movie) throw AppError.notFound("Movie not found.");

        const filmSeriesId =
          input.filmSeriesId === undefined
            ? existing.filmSeriesId
            : input.filmSeriesId;
        if (filmSeriesId && filmSeriesId !== existing.filmSeriesId) {
          const filmSeries = await tx.filmSeries.findFirst({
            where: {
              id: filmSeriesId,
              organizationId: auditorium.location.organizationId,
              active: true,
            },
          });
          if (!filmSeries) throw AppError.notFound("Film series not found.");
        }

        const startsAt = input.startsAt
          ? new Date(input.startsAt)
          : existing.startsAt;
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(
          featureStartsAt.getTime() + movie.runtimeMinutes * 60000,
        );
        const cleaningMinutes = Math.max(
          this.minimumCinemaCleaningMinutes,
          auditorium.location.cleaningBufferMinutes,
        );
        const roomReadyAt = new Date(
          endsAt.getTime() + cleaningMinutes * 60000,
        );
        const priceTier =
          input.priceTierId === undefined
            ? { id: existing.priceTierId }
            : await this.resolvePriceTier(
                tx,
                auditorium.location.organizationId,
                auditorium.location.timezone,
                startsAt,
                input.priceTierId,
              );
        const conflict = await tx.showtime.findFirst({
          where: {
            id: { not: id },
            auditoriumId,
            priceTierId: priceTier.id,
            startsAt: { lt: roomReadyAt },
            roomReadyAt: { gt: startsAt },
          },
          include: { movie: true },
        });
        if (conflict) {
          throw AppError.conflict(
            `Conflicts with ${conflict.movie.title} at ${conflict.startsAt.toISOString()}.`,
            {
              conflictingShowtimeId: conflict.id,
              roomReadyAt: conflict.roomReadyAt.toISOString(),
            },
          );
        }

        const showtime = await tx.showtime.update({
          where: { id },
          data: {
            movieId,
            auditoriumId,
            priceTierId: priceTier.id,
            startsAt,
            featureStartsAt,
            endsAt,
            roomReadyAt,
            onSale: input.onSale ?? existing.onSale,
            filmSeriesId,
            presentation: input.presentation ?? existing.presentation,
            format: input.format === undefined ? existing.format : input.format,
          },
          include: {
            movie: true,
            auditorium: true,
            priceTier: true,
            filmSeries: true,
          },
        });
        if (auditoriumId !== existing.auditoriumId) {
          const activeHolds = await tx.seatHold.count({
            where: {
              showtimeSeat: { showtimeId: id },
              releasedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          if (activeHolds) {
            throw AppError.conflict(
              "A showtime with active seat holds cannot be moved to another room.",
            );
          }
          await tx.showtimeSeat.deleteMany({ where: { showtimeId: id } });
          const seats = await this.sellableSeatIds(tx, auditorium);
          await tx.showtimeSeat.createMany({
            data: seats.map((seat) => ({ showtimeId: id, seatId: seat.id })),
          });
        }
        await tx.auditEvent.create({
          data: {
            actorType: AuditActorType.EMPLOYEE,
            actorId: actor.sub,
            action: "showtime.updated",
            entityType: "Showtime",
            entityId: showtime.id,
            locationId,
            beforeState: {
              movieId: existing.movieId,
              auditoriumId: existing.auditoriumId,
              priceTierId: existing.priceTierId,
              startsAt: existing.startsAt.toISOString(),
            },
            afterState: {
              movieId,
              auditoriumId,
              priceTierId: priceTier.id,
              startsAt: startsAt.toISOString(),
              roomReadyAt: roomReadyAt.toISOString(),
              filmSeriesId,
              presentation: input.presentation ?? existing.presentation,
              format:
                input.format === undefined ? existing.format : input.format,
              requestId,
              requestFingerprint,
            },
          },
        });
        return showtime;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await updateAttempt();
      } catch (error) {
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!serializationFailure || attempt === 2) throw error;
      }
    }
    throw AppError.conflict(
      "The showtime update could not be completed. Try again.",
    );
  }

  async moveShowtimeGroup(
    actor: RequestActor,
    input: MoveShowtimeGroupInput,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, moves: input.moves }))
      .digest("hex");
    const moveAttempt = () => prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const replay = await tx.auditEvent.findFirst({
          where: {
            locationId,
            action: "showtime.group_moved",
            afterState: { path: ["requestId"], equals: requestId },
          },
        });
        if (replay) {
          const state = replay.afterState as { requestFingerprint?: string } | null;
          if (state?.requestFingerprint !== requestFingerprint) {
            throw AppError.conflict(
              "The showtime-move key was already used with different details.",
            );
          }
          const showtimes = await tx.showtime.findMany({
            where: {
              id: { in: input.moves.map((move) => move.showtimeId) },
              auditorium: { locationId },
            },
            include: {
              movie: true,
              auditorium: true,
              priceTier: true,
              filmSeries: true,
            },
          });
          if (showtimes.length !== input.moves.length) {
            throw AppError.conflict("One or more moved showtimes are no longer available.");
          }
          return { showtimes };
        }
        const ids = input.moves.map((move) => move.showtimeId);
        const existing = await tx.showtime.findMany({
          where: { id: { in: ids }, auditorium: { locationId } },
          include: { movie: true, auditorium: { include: { location: true } } },
        });
        if (existing.length !== ids.length)
          throw AppError.notFound("One or more showtimes were not found.");

        const byId = new Map(
          existing.map((showtime) => [showtime.id, showtime]),
        );
        const requestedAuditoriumIds = [
          ...new Set(
            input.moves
              .map((move) => move.auditoriumId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const targetAuditoriums = requestedAuditoriumIds.length
          ? await tx.auditorium.findMany({
              where: {
                id: { in: requestedAuditoriumIds },
                locationId,
                active: true,
              },
              include: { location: true },
            })
          : [];
        if (targetAuditoriums.length !== requestedAuditoriumIds.length)
          throw AppError.notFound(
            "One or more target auditoriums were not found.",
          );
        const targetAuditoriumById = new Map(
          targetAuditoriums.map((auditorium) => [auditorium.id, auditorium]),
        );
        const auditoriumIds = [
          ...new Set([
            ...existing.map((showtime) => showtime.auditoriumId),
            ...requestedAuditoriumIds,
          ]),
        ].sort();
        for (const auditoriumId of auditoriumIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditoriumId}))`;
        }

        const proposed = input.moves.map((move) => {
          const showtime = byId.get(move.showtimeId)!;
          const auditorium = move.auditoriumId
            ? targetAuditoriumById.get(move.auditoriumId)!
            : showtime.auditorium;
          const startsAt = new Date(move.startsAt);
          const featureStartsAt = new Date(
            startsAt.getTime() +
              auditorium.location.preShowBufferMinutes * 60000,
          );
          const endsAt = new Date(
            featureStartsAt.getTime() + showtime.movie.runtimeMinutes * 60000,
          );
          const roomReadyAt = new Date(
            endsAt.getTime() +
              Math.max(
                this.minimumCinemaCleaningMinutes,
                auditorium.location.cleaningBufferMinutes,
              ) *
                60000,
          );
          return {
            showtime,
            auditorium,
            startsAt,
            featureStartsAt,
            endsAt,
            roomReadyAt,
          };
        });

        for (let leftIndex = 0; leftIndex < proposed.length; leftIndex += 1) {
          for (
            let rightIndex = leftIndex + 1;
            rightIndex < proposed.length;
            rightIndex += 1
          ) {
            const left = proposed[leftIndex]!;
            const right = proposed[rightIndex]!;
            if (
              left.auditorium.id === right.auditorium.id &&
              left.startsAt < right.roomReadyAt &&
              left.roomReadyAt > right.startsAt
            ) {
              throw AppError.conflict(
                `The selected move would overlap ${left.showtime.movie.title} and ${right.showtime.movie.title}.`,
              );
            }
          }
        }

        const earliest = new Date(
          Math.min(...proposed.map((move) => move.startsAt.getTime())),
        );
        const latest = new Date(
          Math.max(...proposed.map((move) => move.roomReadyAt.getTime())),
        );
        const nearby = await tx.showtime.findMany({
          where: {
            id: { notIn: ids },
            auditoriumId: { in: auditoriumIds },
            startsAt: { lt: latest },
            roomReadyAt: { gt: earliest },
          },
          include: { movie: true },
        });
        for (const move of proposed) {
          const conflict = nearby.find(
            (showtime) =>
              showtime.auditoriumId === move.auditorium.id &&
              move.startsAt < showtime.roomReadyAt &&
              move.roomReadyAt > showtime.startsAt,
          );
          if (conflict)
            throw AppError.conflict(
              `Conflicts with ${conflict.movie.title} at ${conflict.startsAt.toISOString()}.`,
            );
        }

        const updated = [];
        for (const move of proposed) {
          if (move.auditorium.id !== move.showtime.auditoriumId) {
            const activeHolds = await tx.seatHold.count({
              where: {
                showtimeSeat: { showtimeId: move.showtime.id },
                releasedAt: null,
                expiresAt: { gt: new Date() },
              },
            });
            if (activeHolds)
              throw AppError.conflict(
                "A showtime with active seat holds cannot be moved to another room.",
              );
          }
          updated.push(
            await tx.showtime.update({
              where: { id: move.showtime.id },
              data: {
                auditoriumId: move.auditorium.id,
                startsAt: move.startsAt,
                featureStartsAt: move.featureStartsAt,
                endsAt: move.endsAt,
                roomReadyAt: move.roomReadyAt,
              },
              include: {
                movie: true,
                auditorium: true,
                priceTier: true,
                filmSeries: true,
              },
            }),
          );
          if (move.auditorium.id !== move.showtime.auditoriumId) {
            await tx.showtimeSeat.deleteMany({
              where: { showtimeId: move.showtime.id },
            });
            const seats = await this.sellableSeatIds(tx, move.auditorium);
            await tx.showtimeSeat.createMany({
              data: seats.map((seat) => ({
                showtimeId: move.showtime.id,
                seatId: seat.id,
              })),
            });
          }
          await tx.auditEvent.create({
            data: {
              actorType: AuditActorType.EMPLOYEE,
              actorId: actor.sub,
              action: "showtime.group_moved",
              entityType: "Showtime",
              entityId: move.showtime.id,
              locationId,
              beforeState: {
                auditoriumId: move.showtime.auditoriumId,
                startsAt: move.showtime.startsAt.toISOString(),
              },
              afterState: {
                auditoriumId: move.auditorium.id,
                startsAt: move.startsAt.toISOString(),
                roomReadyAt: move.roomReadyAt.toISOString(),
                groupSize: proposed.length,
                requestId,
                requestFingerprint,
              },
            },
          });
        }
        return { showtimes: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await moveAttempt();
      } catch (error) {
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!serializationFailure || attempt === 2) throw error;
      }
    }
    throw AppError.conflict("The showtime move could not be completed. Try again.");
  }

  async removeShowtime(
    actor: RequestActor,
    id: string,
    requestId: string = randomUUID(),
  ) {
    const locationId = this.requireLocation(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw AppError.validationFailed("Idempotency key must be a UUID.");
    }
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ locationId, showtimeId: id }))
      .digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({
        where: {
          locationId,
          action: "showtime.removed",
          afterState: { path: ["requestId"], equals: requestId },
        },
      });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) {
          throw AppError.conflict(
            "The showtime-removal key was already used for another showing.",
          );
        }
        return { id, removed: true };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const showtime = await tx.showtime.findFirst({
        where: { id, auditorium: { locationId } },
        include: { movie: true, auditorium: true },
      });
      if (!showtime) throw AppError.notFound("Showtime not found.");
      if (showtime.startsAt <= new Date()) {
        throw AppError.conflict(
          "Past or already-started showtimes are retained for reporting and cannot be removed.",
        );
      }

      const now = new Date();
      const [tickets, restaurantTabs, restaurantOrders, activeSeatHolds] =
        await Promise.all([
          tx.ticket.count({ where: { showtimeSeat: { showtimeId: id } } }),
          tx.restaurantTab.count({ where: { showtimeId: id } }),
          tx.restaurantOrder.count({
            where: { showtimeSeat: { showtimeId: id } },
          }),
          tx.seatHold.count({
            where: {
              showtimeSeat: { showtimeId: id },
              releasedAt: null,
              expiresAt: { gt: now },
            },
          }),
        ]);
      if (tickets) {
        throw AppError.conflict(
          "This showtime has ticket records. Cancel or refund affected tickets instead of removing it.",
        );
      }
      if (restaurantTabs || restaurantOrders) {
        throw AppError.conflict(
          "This showtime has restaurant activity and must be retained for operations and reporting.",
        );
      }
      if (activeSeatHolds) {
        throw AppError.conflict(
          "This showtime has active seat holds. Close sales and wait for the holds to expire before removing it.",
        );
      }

      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          locationId,
          action: "showtime.removed",
          entityType: "Showtime",
          entityId: id,
          beforeState: {
            movieId: showtime.movieId,
            movieTitle: showtime.movie.title,
            auditoriumId: showtime.auditoriumId,
            auditoriumName: showtime.auditorium.name,
            startsAt: showtime.startsAt.toISOString(),
            onSale: showtime.onSale,
          },
          afterState: {
            removed: true,
            requestId,
            requestFingerprint,
          },
        },
      });
      await tx.showtime.delete({ where: { id } });
      return { id, removed: true };
    });
  }

  async publicBranding(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");
    return {
      locationId: location.id,
      name: location.name,
      logoUrl: location.customerLogoUrl,
      accentColor: location.customerAccentColor,
      accentMutedColor: location.customerAccentMutedColor,
      backgroundColor: location.customerBackgroundColor,
      backgroundGlowColor: location.customerBackgroundGlowColor,
      surfaceColor: location.customerSurfaceColor,
      textColor: location.customerTextColor,
      mutedTextColor: location.customerMutedTextColor,
    };
  }

  async recordCustomerAnalyticsEvent(locationId: string | undefined, input: { event: string; path?: string }) {
    const settings = await prisma.platformBrandSettings.findUnique({ where: { id: "platform" }, select: { analytics: true } });
    const analytics = settings?.analytics as { enabled?: boolean; provider?: string } | undefined;
    if (analytics?.enabled !== true) return { accepted: false };

    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true, organization: { active: true } }, select: { id: true, timezone: true } })
      : await prisma.location.findFirst({ where: { active: true, organization: { active: true } }, orderBy: { createdAt: "asc" }, select: { id: true, timezone: true } });
    if (!location) throw AppError.notFound("Location not found.");

    const parts = new Intl.DateTimeFormat("en-US", { timeZone: location.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: "year" | "month" | "day") => parts.find((entry) => entry.type === type)?.value ?? "";
    const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
    const requestedPath = input.path?.trim() || "/";
    const publicAnalyticsPaths = new Set(["/", "/about", "/account", "/afterglow", "/coming-soon", "/dining-bar", "/directions", "/donate", "/film-series", "/film-series/:seriesId", "/gift-cards", "/membership", "/movie/:movieId", "/privacy", "/private-events", "/showtimes", "/signage", "/tickets/:orderId"]);
    const acquisitionSources = new Set(["Direct", "Google", "Bing", "Facebook", "Instagram", "X", "Email", "Other referral", "Other campaign"]);
    const path = input.event === "Pageview" && publicAnalyticsPaths.has(requestedPath) ? requestedPath : input.event === "Acquisition Source" && acquisitionSources.has(requestedPath) ? requestedPath : "";
    await prisma.customerAnalyticsDaily.upsert({
      where: { locationId_date_event_path: { locationId: location.id, date, event: input.event, path } },
      create: { locationId: location.id, date, event: input.event, path, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { accepted: true };
  }

  async publicAdminBranding(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");
    return {
      locationId: location.id,
      name: location.name,
      logoUrl: location.customerLogoUrl,
      accentColor: location.adminAccentColor,
      accentMutedColor: location.adminAccentMutedColor,
      backgroundColor: location.adminBackgroundColor,
      surfaceColor: location.adminSurfaceColor,
      textColor: location.adminTextColor,
      mutedTextColor: location.adminMutedTextColor,
      ui: adminUiConfigSchema.safeParse(location.adminUiConfig).success
        ? adminUiConfigSchema.parse(location.adminUiConfig)
        : adminUiDefaults,
    };
  }

  async publicContent(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");
    const parsed = cinemaContentSchema.safeParse(location.contentPublished);
    return {
      locationId: location.id,
      content: parsed.success ? parsed.data : cinemaContentDefaults,
      publishedAt: location.contentPublishedAt?.toISOString() ?? null,
    };
  }

  async nowPlaying(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");

    // Round trip fix: a showtime that already started must remain visible
    // to the customer for the rest of that calendar day (shown disabled,
    // never removed) -- see docs/PROGRAMMING_AND_SCHEDULING.md's "Past
    // Showtime Display Behavior". The previous 30-minute grace window made
    // showtimes vanish from the response entirely mid-afternoon. A full
    // rolling 24-hour window is a deliberately simple stand-in for "since
    // local midnight at this location" -- it doesn't need the location's
    // own timezone to get the common case right, and the failure mode
    // (a showtime from just under 24h ago lingering a few extra minutes
    // right at a timezone boundary) is far less disruptive than showtimes
    // disappearing during the day they're actually showing.
    const listingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const movies = await prisma.movie.findMany({
      where: {
        organizationId: location.organizationId,
        active: true,
        showtimes: {
          some: {
            onSale: true,
            startsAt: { gte: listingCutoff },
            auditorium: { locationId: location.id },
          },
        },
      },
      include: {
        showtimes: {
          where: {
            onSale: true,
            startsAt: { gte: listingCutoff },
            auditorium: { locationId: location.id },
          },
          select: {
            id: true,
            startsAt: true,
            presentation: true,
            format: true,
            filmSeries: { select: { id: true, name: true } },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: {
              select: {
                name: true,
                ticketPriceMinor: true,
                feeMinor: true,
                currency: true,
              },
            },
          },
          orderBy: { startsAt: "asc" },
        },
      },
    });

    // Round trip fix: movies are ordered by their next upcoming showtime,
    // not alphabetically -- a movie playing at 11am no longer gets stuck
    // behind one that first plays at 1:50pm just because its title sorts
    // later. A movie with no showtimes left in this window can't happen
    // here (the `where` above already requires at least one), but the
    // fallback keeps this total in case that ever changes.
    const sortedMovies = [...movies].sort((a, b) => {
      const aNext = a.showtimes[0]?.startsAt.getTime() ?? Infinity;
      const bNext = b.showtimes[0]?.startsAt.getTime() ?? Infinity;
      return aNext - bNext;
    });

    return {
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        timezone: location.timezone,
      },
      movies: sortedMovies.map((movie) => ({
        ...movie,
        showtimes: dedupePublicShowtimes(
          movie.showtimes.map((showtime) => ({
            ...showtime,
            startsAt: showtime.startsAt.toISOString(),
          })) as PublicShowtime[],
        ),
      })),
    };
  }

  async publicDiningMenu(
    locationId?: string,
  ): Promise<PublicDiningMenuResponse> {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");

    const [categories, movies] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { locationId: location.id, active: true },
        select: {
          id: true,
          name: true,
          items: {
            where: { active: true, is86d: false },
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              priceCents: true,
              isVegan: true,
              isGlutenFree: true,
              modifierGroups: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, selectionType: true, required: true, minSelections: true, maxSelections: true, modifiers: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceDeltaCents: true } } } },
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.movie.findMany({
        where: {
          organizationId: location.organizationId,
          active: true,
          pairings: {
            some: {
              menuItem: {
                active: true,
                is86d: false,
                menuCategory: { locationId: location.id, active: true },
              },
            },
          },
        },
        select: {
          id: true,
          title: true,
          posterUrl: true,
          diningSpecialArtworkUrl: true,
          diningSpecialTitle: true,
          pairings: {
            where: {
              menuItem: {
                active: true,
                is86d: false,
                menuCategory: { locationId: location.id, active: true },
              },
            },
            select: {
              menuItem: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  imageUrl: true,
                  priceCents: true,
                  isVegan: true,
                  isGlutenFree: true,
                  modifierGroups: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, selectionType: true, required: true, minSelections: true, maxSelections: true, modifiers: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceDeltaCents: true } } } },
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { title: "asc" },
      }),
    ]);

    return {
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
      },
      menuPresentation: location.diningMenuAssetUrl && (location.diningMenuAssetType === "IMAGE" || location.diningMenuAssetType === "PDF")
        ? { assetUrl: location.diningMenuAssetUrl, assetType: location.diningMenuAssetType }
        : null,
      categories,
      movieSpecials: movies.map((movie) => ({
        movieId: movie.id,
        movieTitle: movie.title,
        posterUrl: movie.posterUrl,
        artworkUrl: movie.diningSpecialArtworkUrl,
        headline: movie.diningSpecialTitle,
        items: movie.pairings.map((pairing) => pairing.menuItem),
      })),
    };
  }

  async publicMovieDetail(id: string, locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");
    const movie = await prisma.movie.findFirst({
      where: { id, organizationId: location.organizationId, active: true },
      include: {
        showtimes: {
          where: {
            onSale: true,
            startsAt: { gte: new Date() },
            auditorium: { locationId: location.id },
          },
          select: {
            id: true,
            startsAt: true,
            presentation: true,
            format: true,
            filmSeries: { select: { id: true, name: true } },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: {
              select: {
                name: true,
                ticketPriceMinor: true,
                feeMinor: true,
                currency: true,
              },
            },
          },
          orderBy: { startsAt: "asc" },
        },
        pairings: {
          where: {
            menuItem: {
              active: true,
              is86d: false,
              menuCategory: { locationId: location.id },
            },
          },
          include: { menuItem: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!movie) throw AppError.notFound("Movie not found.");
    return {
      location: {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      },
      movie: {
        id: movie.id,
        title: movie.title,
        synopsis: movie.synopsis,
        runtimeMinutes: movie.runtimeMinutes,
        rating: movie.rating,
        posterUrl: movie.posterUrl,
        detailPosterUrl: movie.detailPosterUrl,
        posterPosition: movie.posterPosition,
        detailPosterPosition: movie.detailPosterPosition,
        director: movie.director,
        starring: movie.starring,
        trailerUrl: movie.trailerUrl,
        releaseYear: movie.releaseYear,
        showtimes: movie.showtimes.map((showtime) => ({
          ...showtime,
          startsAt: showtime.startsAt.toISOString(),
        })),
        pairings: movie.pairings.map(({ menuItem }) => ({
          id: menuItem.id,
          name: menuItem.name,
          description: menuItem.description,
          imageUrl: menuItem.imageUrl,
          priceCents: menuItem.priceCents,
        })),
      },
    };
  }

  async publicFilmSeries(locationId?: string) {
    const now = new Date();
    const location = locationId
      ? await prisma.location.findFirst({
          where: {
            id: locationId,
            active: true,
            organization: { active: true },
          },
        })
      : await prisma.location.findFirst({
          where: { active: true, organization: { active: true } },
          orderBy: { createdAt: "asc" },
        });
    if (!location) throw AppError.notFound("Location not found.");

    const series = await prisma.filmSeries.findMany({
      where: {
        organizationId: location.organizationId,
        active: true,
        showtimes: {
          some: {
            onSale: true,
            startsAt: { gte: now },
            auditorium: { locationId: location.id, active: true },
          },
        },
      },
      include: {
        showtimes: {
          where: {
            onSale: true,
            startsAt: { gte: now },
            auditorium: { locationId: location.id, active: true },
            movie: { active: true },
          },
          select: {
            id: true,
            startsAt: true,
            presentation: true,
            format: true,
            movie: {
              select: {
                id: true,
                title: true,
                synopsis: true,
                runtimeMinutes: true,
                rating: true,
                posterUrl: true,
                detailPosterUrl: true,
                posterPosition: true,
                detailPosterPosition: true,
                director: true,
                starring: true,
                trailerUrl: true,
                releaseYear: true,
              },
            },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: {
              select: {
                name: true,
                ticketPriceMinor: true,
                feeMinor: true,
                currency: true,
              },
            },
          },
          orderBy: { startsAt: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return {
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        timezone: location.timezone,
      },
      series: series
        .map((entry) => {
          const movies = new Map<
            string,
            {
              id: string;
              title: string;
              synopsis: string | null;
              runtimeMinutes: number;
              rating: string | null;
              posterUrl: string | null;
              detailPosterUrl: string | null;
              posterPosition: string;
              detailPosterPosition: string;
              director: string | null;
              starring: string | null;
              trailerUrl: string | null;
              releaseYear: number | null;
              showtimes: Array<{
                id: string;
                startsAt: string;
                presentation:
                  "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
                format: string | null;
                filmSeries: { id: string; name: string } | null;
                auditorium: { id: string; name: string; capacity: number };
                priceTier: {
                  name: string;
                  ticketPriceMinor: number;
                  feeMinor: number;
                  currency: string;
                };
              }>;
            }
          >();
          for (const showtime of entry.showtimes) {
            const movie = movies.get(showtime.movie.id) ?? {
              ...showtime.movie,
              showtimes: [],
            };
            movie.showtimes.push({
              id: showtime.id,
              startsAt: showtime.startsAt.toISOString(),
              presentation: showtimePresentationSchema.parse(
                showtime.presentation,
              ),
              format: showtime.format,
              filmSeries: { id: entry.id, name: entry.name },
              auditorium: showtime.auditorium,
              priceTier: showtime.priceTier,
            });
            movies.set(movie.id, movie);
          }
          return {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            artworkUrl: entry.artworkUrl,
            movies: Array.from(movies.values()),
            sortOrder: entry.sortOrder,
          };
        })
        .sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        )
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          artworkUrl: entry.artworkUrl,
          movies: entry.movies,
        })),
    };
  }

  async adminSeatAvailability(actor: RequestActor, showtimeId: string) {
    return this.seatAvailability(showtimeId, undefined, {
      includeOffSale: true,
      locationId: this.requireLocation(actor),
    });
  }

  async seatAvailability(showtimeId: string, holderKey?: string, options?: { includeOffSale?: boolean; locationId?: string }) {
    const now = new Date();
    const showtimeWhere = {
      id: showtimeId,
      ...(options?.includeOffSale ? {} : { onSale: true }),
      ...(options?.locationId ? { auditorium: { locationId: options.locationId } } : {}),
    };
    let generalAdmissionSeatIds: string[] | undefined;
    await prisma.$transaction(async (tx) => {
      const showtime = await tx.showtime.findFirst({
        where: showtimeWhere,
        include: { auditorium: true },
      });
      if (!showtime) return;
      if (showtime.auditorium.seatingMode !== "GENERAL_ADMISSION") return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${showtime.auditoriumId}))`;
      const seats = await this.sellableSeatIds(tx, showtime.auditorium);
      generalAdmissionSeatIds = seats.map((seat) => seat.id);
      await tx.showtimeSeat.createMany({
        data: seats.map((seat) => ({
          showtimeId,
          seatId: seat.id,
        })),
        skipDuplicates: true,
      });
    });
    await prisma.seatHold.updateMany({
      where: {
        releasedAt: null,
        expiresAt: { lte: now },
        showtimeSeat: { showtimeId },
      },
      data: { releasedAt: now },
    });
    const showtime = await prisma.showtime.findFirst({
      where: showtimeWhere,
      include: {
        movie: true,
        auditorium: { include: { location: { select: { timezone: true } }, seatMap: { select: { layoutJson: true } } } },
        priceTier: true,
        showtimeSeats: {
          where: generalAdmissionSeatIds
            ? { seatId: { in: generalAdmissionSeatIds } }
            : undefined,
          include: {
            seat: true,
            holds: {
              where: { releasedAt: null, expiresAt: { gt: now } },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            tickets: {
              where: { status: { notIn: ["REFUNDED", "CANCELED"] } },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!showtime) throw AppError.notFound("Showtime not found.");
    const seats = showtime.showtimeSeats
      .sort((a, b) => a.seat.y - b.seat.y || a.seat.x - b.seat.x)
      .map((inventory) => {
        const hold = inventory.holds[0];
        return {
          id: inventory.seat.id,
          inventoryId: inventory.id,
          label: inventory.seat.label,
          rowLabel: inventory.seat.rowLabel,
          number: inventory.seat.number,
          x: inventory.seat.x,
          y: inventory.seat.y,
          type: inventory.seat.type,
          tableGroupId: inventory.seat.tableGroupId,
          tablePosition: inventory.seat.tablePosition,
          state: inventory.blockedAt
            ? "BLOCKED"
            : inventory.tickets.length
              ? "SOLD"
              : hold
                ? "HELD"
                : "AVAILABLE",
          heldByMe: Boolean(hold && holderKey && hold.holderKey === holderKey),
          holdToken:
            hold && holderKey && hold.holderKey === holderKey
              ? hold.holdToken
              : undefined,
          expiresAt:
            hold && holderKey && hold.holderKey === holderKey
              ? hold.expiresAt.toISOString()
              : undefined,
        };
      });
    return {
      showtime: {
        id: showtime.id,
        startsAt: showtime.startsAt.toISOString(),
        timezone: showtime.auditorium.location.timezone,
        movie: { id: showtime.movie.id, title: showtime.movie.title },
        auditorium: {
          id: showtime.auditorium.id,
          name: showtime.auditorium.name,
          capacity: showtime.auditorium.capacity,
          seatingMode: showtime.auditorium.seatingMode,
          seatingStyle: resolvedSeatingStyle(
            showtime.auditorium.seatMap?.layoutJson,
            seats,
          ),
        },
        priceTier: {
          ticketPriceMinor: showtime.priceTier.ticketPriceMinor,
          feeMinor: showtime.priceTier.feeMinor,
          currency: showtime.priceTier.currency,
        },
      },
      serverTime: now.toISOString(),
      holdDurationSeconds: 300,
      seats,
      counts: {
        available: seats.filter((seat) => seat.state === "AVAILABLE").length,
        held: seats.filter((seat) => seat.state === "HELD").length,
        sold: seats.filter((seat) => seat.state === "SOLD").length,
        blocked: seats.filter((seat) => seat.state === "BLOCKED").length,
      },
    };
  }

  async joinShowtimeWaitlist(showtimeId: string, email: string, suppliedRequestId?: string) {
    const requestId = suppliedRequestId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const normalizedEmail = email.trim().toLowerCase();
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ showtimeId, email: normalizedEmail })).digest("hex");
    const availability = await this.seatAvailability(showtimeId);
    if (new Date(availability.showtime.startsAt) <= new Date()) throw AppError.conflict("This showtime has already started.");
    if (availability.counts.available > 0) throw AppError.conflict("Tickets are currently available for this showtime.");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.showtimeWaitlistEntry.findUnique({ where: { requestId } });
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) throw AppError.conflict("The waitlist request key was already used with different details.");
        return { joined: true, expiresAt: replay.expiresAt };
      }
      const entry = await tx.showtimeWaitlistEntry.upsert({
        where: { showtimeId_email: { showtimeId, email: normalizedEmail } },
        create: { showtimeId, email: normalizedEmail, expiresAt: new Date(availability.showtime.startsAt), requestId, requestFingerprint },
        update: { status: "ACTIVE", expiresAt: new Date(availability.showtime.startsAt), requestId, requestFingerprint, notifiedAt: null, notificationClaimedAt: null, notificationMessageId: null, notificationError: null },
      });
      return { joined: true, expiresAt: entry.expiresAt };
    });
  }

  async holdSeats(showtimeId: string, seatIds: string[], holderKey: string) {
    const uniqueSeatIds = [...new Set(seatIds)].sort();
    if (!holderKey || holderKey.length < 16 || holderKey.length > 200) {
      throw AppError.validationFailed("A valid checkout session is required.");
    }
    if (!uniqueSeatIds.length || uniqueSeatIds.length > 10) {
      throw AppError.validationFailed("Select between 1 and 10 seats.");
    }
    return prisma.$transaction(
      async (tx) => {
        const showtime = await tx.showtime.findFirst({
          where: { id: showtimeId, onSale: true, startsAt: { gt: new Date() } },
          select: { id: true },
        });
        if (!showtime) throw AppError.notFound("Showtime is not available.");

        const rows = await tx.$queryRaw<
          Array<{ id: string; seatId: string; blockedAt: Date | null }>
        >(
          Prisma.sql`
            SELECT "id", "seatId", "blockedAt"
            FROM "showtime_seats"
            WHERE "showtimeId" = ${showtimeId}
              AND "seatId" IN (${Prisma.join(uniqueSeatIds)})
            ORDER BY "seatId"
            FOR UPDATE
          `,
        );
        if (rows.length !== uniqueSeatIds.length)
          throw AppError.notFound("One or more seats do not exist.");
        if (rows.some((row) => row.blockedAt))
          throw AppError.conflict("One or more seats are blocked.");

        const now = new Date();
        const inventoryIds = rows.map((row) => row.id);
        const sold = await tx.ticket.findFirst({
          where: {
            showtimeSeatId: { in: inventoryIds },
            status: { notIn: ["REFUNDED", "CANCELED"] },
          },
        });
        if (sold)
          throw AppError.conflict("One or more seats have already been sold.");
        await tx.seatHold.updateMany({
          where: {
            showtimeSeatId: { in: inventoryIds },
            releasedAt: null,
            expiresAt: { lte: now },
          },
          data: { releasedAt: now },
        });
        const active = await tx.seatHold.findMany({
          where: {
            showtimeSeatId: { in: inventoryIds },
            releasedAt: null,
            expiresAt: { gt: now },
          },
        });
        const mine = active.filter((hold) => hold.holderKey === holderKey);
        if (active.length && mine.length !== uniqueSeatIds.length) {
          throw AppError.conflict(
            "One or more seats were just held by another guest.",
          );
        }
        if (mine.length === uniqueSeatIds.length) return mine;

        const expiresAt = new Date(now.getTime() + 5 * 60_000);
        await tx.seatHold.createMany({
          data: inventoryIds.map((showtimeSeatId) => ({
            showtimeSeatId,
            holderKey,
            holdToken: randomUUID(),
            expiresAt,
          })),
        });
        return tx.seatHold.findMany({
          where: {
            showtimeSeatId: { in: inventoryIds },
            holderKey,
            releasedAt: null,
            expiresAt,
          },
          orderBy: { createdAt: "asc" },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async releaseSeatHold(holdToken: string, holderKey: string) {
    const result = await prisma.seatHold.updateMany({
      where: { holdToken, holderKey, releasedAt: null },
      data: { releasedAt: new Date() },
    });
    if (!result.count) throw AppError.notFound("Active seat hold not found.");
    return { released: true };
  }

  async expireSeatHolds() {
    const now = new Date();
    const result = await prisma.seatHold.updateMany({
      where: { releasedAt: null, expiresAt: { lte: now } },
      data: { releasedAt: now },
    });
    return { expired: result.count };
  }

  private async resolvePriceTier(
    tx: Prisma.TransactionClient,
    organizationId: string,
    timezone: string,
    startsAt: Date,
    requestedId?: string,
  ) {
    if (requestedId) {
      const requested = await tx.priceTier.findFirst({
        where: { id: requestedId, organizationId, active: true },
      });
      if (!requested) throw AppError.notFound("Price tier not found.");
      return requested;
    }
    const weekdayName = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(startsAt);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekdayName,
    );
    const tiers = await tx.priceTier.findMany({
      where: { organizationId, active: true },
      orderBy: { ticketPriceMinor: "asc" },
    });
    const matching = tiers.find((tier) =>
      tier.appliesOnWeekdays.includes(weekday),
    );
    const defaultTier = tiers.find(
      (tier) => tier.appliesOnWeekdays.length === 0,
    );
    if (!matching && !defaultTier)
      throw AppError.conflict("No active ticket price is configured.");
    return matching ?? defaultTier!;
  }
}
