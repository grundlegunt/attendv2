import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { AuditActorType, Prisma, prisma } from "@cinema/database";
import {
  adminUiConfigSchema,
  adminUiDefaults,
  createAuditoriumRequestSchema,
  createFilmSeriesRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  duplicateShowtimeDayRequestSchema,
  moveShowtimeGroupRequestSchema,
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
} from "@cinema/shared";
import type { PublicDiningMenuResponse } from "@cinema/shared";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";

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

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
      ? new Date(input.preferredDate)
      : null;
    if (preferredDate && Number.isNaN(preferredDate.getTime()))
      throw AppError.validationFailed("Preferred date is invalid.");
    return prisma.privateEventInquiry.create({
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
  }
  private expiryTimer?: ReturnType<typeof setInterval>;
  private readonly minimumCinemaCleaningMinutes = 15;

  onModuleInit() {
    this.expiryTimer = setInterval(() => void this.expireSeatHolds(), 15_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
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
        where: { auditorium: { locationId, active: true } },
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
  ) {
    const locationId = this.requireLocation(actor);
    const weekStartsAt = new Date(input.weekStartsAt);
    const weekEndsAt = new Date(weekStartsAt.getTime() + 7 * 86_400_000);
    const showtimes = await prisma.showtime.findMany({
      where: {
        auditorium: { locationId },
        startsAt: { gte: weekStartsAt, lt: weekEndsAt },
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
    try {
      const plan = await prisma.schedulePlan.create({
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
      await prisma.auditEvent.create({
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
          },
        },
      });
      return plan;
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
    const weekEndsAt = new Date(plan.weekStartsAt.getTime() + 7 * 86_400_000);
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
      if (startsAtDate < plan.weekStartsAt || startsAtDate >= weekEndsAt)
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
  ) {
    const locationId = this.requireLocation(actor);
    const validation = await this.validateSchedulePlan(actor, id);
    if (!validation.valid)
      throw AppError.conflict(
        "Resolve every saved-plan issue before publishing.",
        { issues: validation.issues },
      );
    const expectedUpdatedAt = new Date(expectedUpdatedAtValue);
    if (validation.expectedUpdatedAt !== expectedUpdatedAt.toISOString())
      throw AppError.conflict(
        "This plan changed after it was checked. Check it again before publishing.",
      );

    return prisma.$transaction(
      async (tx) => {
        const plan = await tx.schedulePlan.findFirst({
          where: { id, locationId, updatedAt: expectedUpdatedAt },
        });
        if (!plan)
          throw AppError.conflict(
            "This plan changed after it was checked. Check it again before publishing.",
          );
        if (plan.weekStartsAt <= new Date())
          throw AppError.conflict(
            "Only a future schedule week can be published from a saved plan.",
          );
        const weekEndsAt = new Date(
          plan.weekStartsAt.getTime() + 7 * 86_400_000,
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
            startsAt: { gte: plan.weekStartsAt, lt: weekEndsAt },
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
  }

  async deleteSchedulePlan(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    const plan = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
      select: { id: true, name: true, weekStartsAt: true },
    });
    if (!plan) throw AppError.notFound("Schedule plan not found.");
    await prisma.$transaction([
      prisma.schedulePlan.delete({ where: { id: plan.id } }),
      prisma.auditEvent.create({
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
        },
      }),
    ]);
    return { deleted: true };
  }

  async duplicateSchedulePlan(actor: RequestActor, id: string, name: string) {
    const locationId = this.requireLocation(actor);
    const source = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
    });
    if (!source) throw AppError.notFound("Schedule plan not found.");
    try {
      const plan = await prisma.schedulePlan.create({
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
      await prisma.auditEvent.create({
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
          },
        },
      });
      return plan;
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
  ) {
    const locationId = this.requireLocation(actor);
    const [plan, location] = await Promise.all([
      prisma.schedulePlan.findFirst({ where: { id, locationId } }),
      prisma.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      }),
    ]);
    if (!plan || !location) throw AppError.notFound("Schedule plan not found.");
    const startsAt = new Date(input.startsAt);
    const weekEndsAt = new Date(plan.weekStartsAt.getTime() + 7 * 86_400_000);
    if (startsAt < plan.weekStartsAt || startsAt >= weekEndsAt)
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
    const snapshot = Array.isArray(plan.snapshotJson)
      ? [...plan.snapshotJson]
      : [];
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
    snapshot.push(showtime);
    snapshot.sort((left, right) =>
      String((left as { startsAt?: unknown }).startsAt ?? "").localeCompare(
        String((right as { startsAt?: unknown }).startsAt ?? ""),
      ),
    );
    return prisma.$transaction(async (tx) => {
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
          action: "schedule_plan.showtime_added",
          entityType: "SchedulePlan",
          entityId: plan.id,
          locationId,
          afterState: { showtime, showtimeCount: snapshot.length },
        },
      });
      return saved;
    });
  }

  async renameSchedulePlan(actor: RequestActor, id: string, name: string) {
    const locationId = this.requireLocation(actor);
    const plan = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
      select: { id: true, name: true },
    });
    if (!plan) throw AppError.notFound("Schedule plan not found.");
    try {
      const updated = await prisma.schedulePlan.update({
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
      await prisma.auditEvent.create({
        data: {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "schedule_plan.renamed",
          entityType: "SchedulePlan",
          entityId: plan.id,
          locationId,
          beforeState: { name: plan.name },
          afterState: { name: updated.name },
        },
      });
      return updated;
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
  ) {
    const locationId = this.requireLocation(actor);
    const plan = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
    });
    if (!plan) throw AppError.notFound("Schedule plan not found.");
    const snapshot = Array.isArray(plan.snapshotJson)
      ? [...plan.snapshotJson]
      : [];
    if (!Number.isInteger(index) || index < 0 || index >= snapshot.length)
      throw AppError.validationFailed("Saved showtime not found in this plan.");
    const [removed] = snapshot.splice(index, 1);
    const updated = await prisma.$transaction(async (tx) => {
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
          afterState: { showtimeCount: snapshot.length },
        },
      });
      return saved;
    });
    return updated;
  }

  async updateSchedulePlanShowtime(
    actor: RequestActor,
    id: string,
    index: number,
    startsAtValue: string,
  ) {
    const locationId = this.requireLocation(actor);
    const plan = await prisma.schedulePlan.findFirst({
      where: { id, locationId },
    });
    if (!plan) throw AppError.notFound("Schedule plan not found.");
    const snapshot = Array.isArray(plan.snapshotJson)
      ? [...plan.snapshotJson]
      : [];
    if (!Number.isInteger(index) || index < 0 || index >= snapshot.length)
      throw AppError.validationFailed("Saved showtime not found in this plan.");
    const startsAt = new Date(startsAtValue);
    const weekEndsAt = new Date(plan.weekStartsAt.getTime() + 7 * 86_400_000);
    if (startsAt < plan.weekStartsAt || startsAt >= weekEndsAt)
      throw AppError.validationFailed(
        "The showing must stay within this plan's week.",
      );
    const existing = snapshot[index];
    if (!existing || typeof existing !== "object" || Array.isArray(existing))
      throw AppError.validationFailed("The saved showtime is invalid.");
    const changed = { ...existing, startsAt: startsAt.toISOString() };
    snapshot[index] = changed;
    return prisma.$transaction(async (tx) => {
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
          },
        },
      });
      return saved;
    });
  }

  async createAuditorium(actor: RequestActor, input: AuditoriumInput) {
    const locationId = this.requireLocation(actor);
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

    try {
      return await prisma.$transaction(async (tx) => {
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
  ) {
    const locationId = this.requireLocation(actor);
    const reservedSeats = input.seats ?? [];
    const layoutErrors =
      input.seatingMode === "GENERAL_ADMISSION"
        ? []
        : validateAdvancedSeatLayout(reservedSeats, input.layout!);
    if (layoutErrors.length)
      throw AppError.validationFailed("The seat layout is invalid.", {
        errors: layoutErrors,
      });

    try {
      return await prisma.$transaction(async (tx) => {
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
            },
          },
        });
        return updated;
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
  ) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
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
          },
        },
      });
      return copy;
    });
  }

  async deactivateAuditorium(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
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
          afterState: { active: false },
        },
      });
      return deactivated;
    });
  }

  async createMovie(actor: RequestActor, input: MovieInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
      });
      if (!location) throw AppError.notFound("Location not found.");
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
          },
        },
      });
      return movie;
    });
  }

  async archiveMovie(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
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
          afterState: { active: false },
        },
      });
      return archived;
    });
  }

  async restoreMovie(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
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
          afterState: { active: true },
        },
      });
      return restored;
    });
  }

  async permanentlyDeleteMovie(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
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
        },
      });
      await tx.movie.delete({ where: { id } });
      return { deleted: true, id };
    });
  }

  async updateMovie(actor: RequestActor, id: string, input: MovieUpdateInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({
        where: { id: locationId },
        select: { organizationId: true },
      });
      if (!location) throw AppError.notFound("Location not found.");
      const existing = await tx.movie.findFirst({
        where: { id, organizationId: location.organizationId, active: true },
      });
      if (!existing) throw AppError.notFound("Movie not found.");
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

  async createFilmSeries(actor: RequestActor, input: FilmSeriesInput) {
    const locationId = this.requireLocation(actor);
    try {
      return await prisma.$transaction(async (tx) => {
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { organizationId: true },
        });
        if (!location) throw AppError.notFound("Location not found.");
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
            afterState: { name: filmSeries.name, active: filmSeries.active },
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
  ) {
    const locationId = this.requireLocation(actor);
    try {
      return await prisma.$transaction(async (tx) => {
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { organizationId: true },
        });
        if (!location) throw AppError.notFound("Location not found.");
        const existing = await tx.filmSeries.findFirst({
          where: { id, organizationId: location.organizationId },
        });
        if (!existing) throw AppError.notFound("Film series not found.");
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

  async archiveFilmSeries(actor: RequestActor, id: string) {
    return this.updateFilmSeries(actor, id, { active: false });
  }

  async createShowtime(actor: RequestActor, input: ShowtimeInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(
      async (tx) => {
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
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async duplicateShowtimeDay(
    actor: RequestActor,
    input: DuplicateShowtimeDayInput,
  ) {
    const locationId = this.requireLocation(actor);
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
            },
          },
        });
        return { createdCount: created.length, showtimes: created };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: DUPLICATE_DAY_TRANSACTION_MAX_WAIT_MS,
        timeout: DUPLICATE_DAY_TRANSACTION_TIMEOUT_MS,
      },
    );
  }

  async updateShowtime(
    actor: RequestActor,
    id: string,
    input: ShowtimeUpdateInput,
  ) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.showtime.findFirst({
          where: { id, auditorium: { locationId } },
        });
        if (!existing) throw AppError.notFound("Showtime not found.");

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
            },
          },
        });
        return showtime;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async moveShowtimeGroup(actor: RequestActor, input: MoveShowtimeGroupInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(
      async (tx) => {
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
              },
            },
          });
        }
        return { showtimes: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async removeShowtime(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
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
          afterState: { removed: true },
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
        showtimes: movie.showtimes.map((showtime) => ({
          ...showtime,
          startsAt: showtime.startsAt.toISOString(),
        })),
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

  async seatAvailability(showtimeId: string, holderKey?: string) {
    const now = new Date();
    let generalAdmissionSeatIds: string[] | undefined;
    await prisma.$transaction(async (tx) => {
      const showtime = await tx.showtime.findFirst({
        where: { id: showtimeId, onSale: true },
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
      where: { id: showtimeId, onSale: true },
      include: {
        movie: true,
        auditorium: true,
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
        movie: { id: showtime.movie.id, title: showtime.movie.title },
        auditorium: {
          id: showtime.auditorium.id,
          name: showtime.auditorium.name,
          capacity: showtime.auditorium.capacity,
          seatingMode: showtime.auditorium.seatingMode,
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
