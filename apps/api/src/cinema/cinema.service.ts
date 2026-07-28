import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditActorType, Prisma, prisma } from "@cinema/database";
import {
  createAuditoriumRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  updateShowtimeRequestSchema,
  validateSeatLayout,
} from "@cinema/shared";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";

type AuditoriumInput = ReturnType<typeof createAuditoriumRequestSchema.parse>;
type MovieInput = ReturnType<typeof createMovieRequestSchema.parse>;
type ShowtimeInput = ReturnType<typeof createShowtimeRequestSchema.parse>;
type ShowtimeUpdateInput = ReturnType<typeof updateShowtimeRequestSchema.parse>;

@Injectable()
export class CinemaService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.expiryTimer = setInterval(() => void this.expireSeatHolds(), 15_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }
  private requireLocation(actor: RequestActor): string {
    if (!actor.locationId) throw AppError.forbidden("A location-scoped staff session is required.");
    return actor.locationId;
  }

  async adminBootstrap(actor: RequestActor) {
    const locationId = this.requireLocation(actor);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: {
        auditoriums: {
          where: { active: true },
          include: { seatMap: { include: { seats: { where: { active: true }, orderBy: [{ y: "asc" }, { x: "asc" }] } } } },
          orderBy: { name: "asc" },
        },
        organization: {
          include: {
            movies: { where: { active: true }, orderBy: { title: "asc" } },
            priceTiers: { where: { active: true }, orderBy: { ticketPriceMinor: "asc" } },
          },
        },
      },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const showtimes = await prisma.showtime.findMany({
      where: { auditorium: { locationId }, startsAt: { gte: new Date(Date.now() - 86400000) } },
      include: { movie: true, auditorium: true },
      orderBy: { startsAt: "asc" },
    });
    return { location, showtimes };
  }

  async createAuditorium(actor: RequestActor, input: AuditoriumInput) {
    const locationId = this.requireLocation(actor);
    const layoutErrors = validateSeatLayout(input.seats);
    if (layoutErrors.length) {
      throw AppError.validationFailed("The seat layout is invalid.", { errors: layoutErrors });
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const auditorium = await tx.auditorium.create({
          data: {
            locationId,
            name: input.name,
            capacity: input.seats.length,
            seatMap: {
              create: {
                name: input.seatMapName,
                seats: {
                  create: input.seats.map((seat) => ({
                    ...seat,
                    label: seat.label.toUpperCase(),
                    rowLabel: seat.rowLabel.toUpperCase(),
                    tableGroupId: seat.tableGroupId ?? null,
                    tablePosition: seat.tablePosition ?? null,
                  })),
                },
              },
            },
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
            afterState: { name: auditorium.name, capacity: auditorium.capacity },
          },
        });
        return auditorium;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("An auditorium or seat already uses that name, label, or coordinate.");
      }
      throw error;
    }
  }

  async createMovie(actor: RequestActor, input: MovieInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location) throw AppError.notFound("Location not found.");
      const movie = await tx.movie.create({
        data: {
          organizationId: location.organizationId,
          title: input.title,
          synopsis: input.synopsis ?? null,
          runtimeMinutes: input.runtimeMinutes,
          rating: input.rating ?? null,
          posterUrl: input.posterUrl ?? null,
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
          afterState: { title: movie.title, runtimeMinutes: movie.runtimeMinutes },
        },
      });
      return movie;
    });
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
        if (!auditorium.capacity) throw AppError.conflict("Auditorium must have a seat layout.");

        const movie = await tx.movie.findFirst({
          where: { id: input.movieId, organizationId: auditorium.location.organizationId, active: true },
        });
        if (!movie) throw AppError.notFound("Movie not found.");

        const startsAt = new Date(input.startsAt);
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
        const roomReadyAt = new Date(
          endsAt.getTime() + auditorium.location.cleaningBufferMinutes * 60000,
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
          throw AppError.conflict(`Conflicts with ${conflict.movie.title} at ${conflict.startsAt.toISOString()}.`, {
            conflictingShowtimeId: conflict.id,
            roomReadyAt: conflict.roomReadyAt.toISOString(),
          });
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
          },
          include: { movie: true, auditorium: true },
        });
        const seats = await tx.seat.findMany({
          where: { seatMap: { auditoriumId: auditorium.id }, active: true },
          select: { id: true },
        });
        await tx.showtimeSeat.createMany({
          data: seats.map((seat) => ({ showtimeId: showtime.id, seatId: seat.id })),
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
            },
          },
        });
        return showtime;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateShowtime(actor: RequestActor, id: string, input: ShowtimeUpdateInput) {
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
          where: { id: movieId, organizationId: auditorium.location.organizationId, active: true },
        });
        if (!movie) throw AppError.notFound("Movie not found.");

        const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
        const roomReadyAt = new Date(
          endsAt.getTime() + auditorium.location.cleaningBufferMinutes * 60000,
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
            id: { not: id },
            auditoriumId,
            priceTierId: priceTier.id,
            startsAt: { lt: roomReadyAt },
            roomReadyAt: { gt: startsAt },
          },
          include: { movie: true },
        });
        if (conflict) {
          throw AppError.conflict(`Conflicts with ${conflict.movie.title} at ${conflict.startsAt.toISOString()}.`, {
            conflictingShowtimeId: conflict.id,
            roomReadyAt: conflict.roomReadyAt.toISOString(),
          });
        }

        const showtime = await tx.showtime.update({
          where: { id },
          data: {
            movieId,
            auditoriumId,
            startsAt,
            featureStartsAt,
            endsAt,
            roomReadyAt,
            onSale: input.onSale ?? existing.onSale,
          },
          include: { movie: true, auditorium: true },
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
            throw AppError.conflict("A showtime with active seat holds cannot be moved to another room.");
          }
          await tx.showtimeSeat.deleteMany({ where: { showtimeId: id } });
          const seats = await tx.seat.findMany({
            where: { seatMap: { auditoriumId }, active: true },
            select: { id: true },
          });
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
              startsAt: existing.startsAt.toISOString(),
            },
            afterState: {
              movieId,
              auditoriumId,
              startsAt: startsAt.toISOString(),
              roomReadyAt: roomReadyAt.toISOString(),
            },
          },
        });
        return showtime;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async nowPlaying(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
    if (!location) throw AppError.notFound("Location not found.");

    const movies = await prisma.movie.findMany({
      where: {
        organizationId: location.organizationId,
        active: true,
        showtimes: {
          some: {
            onSale: true,
            startsAt: { gte: new Date(Date.now() - 30 * 60000) },
            auditorium: { locationId: location.id },
          },
        },
      },
      include: {
        showtimes: {
          where: {
            onSale: true,
            startsAt: { gte: new Date(Date.now() - 30 * 60000) },
            auditorium: { locationId: location.id },
          },
          select: {
            id: true,
            startsAt: true,
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: {
              select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true },
            },
          },
          orderBy: { startsAt: "asc" },
        },
      },
      orderBy: { title: "asc" },
    });
    return {
      location: { id: location.id, name: location.name, timezone: location.timezone },
      movies: movies.map((movie) => ({
        ...movie,
        showtimes: movie.showtimes.map((showtime) => ({
          ...showtime,
          startsAt: showtime.startsAt.toISOString(),
        })),
      })),
    };
  }

  async seatAvailability(showtimeId: string, holderKey?: string) {
    const now = new Date();
    await prisma.seatHold.updateMany({
      where: { releasedAt: null, expiresAt: { lte: now }, showtimeSeat: { showtimeId } },
      data: { releasedAt: now },
    });
    const showtime = await prisma.showtime.findFirst({
      where: { id: showtimeId, onSale: true },
      include: {
        movie: true,
        auditorium: true,
        priceTier: true,
        showtimeSeats: {
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
    return {
      showtime: {
        id: showtime.id,
        startsAt: showtime.startsAt.toISOString(),
        movie: { id: showtime.movie.id, title: showtime.movie.title },
        auditorium: {
          id: showtime.auditorium.id,
          name: showtime.auditorium.name,
          capacity: showtime.auditorium.capacity,
        },
        priceTier: {
          ticketPriceMinor: showtime.priceTier.ticketPriceMinor,
          feeMinor: showtime.priceTier.feeMinor,
          currency: showtime.priceTier.currency,
        },
      },
      serverTime: now.toISOString(),
      holdDurationSeconds: 300,
      seats: showtime.showtimeSeats
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
            holdToken: hold && holderKey && hold.holderKey === holderKey ? hold.holdToken : undefined,
            expiresAt: hold && holderKey && hold.holderKey === holderKey
              ? hold.expiresAt.toISOString()
              : undefined,
          };
        }),
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

        const rows = await tx.$queryRaw<Array<{ id: string; seatId: string; blockedAt: Date | null }>>(
          Prisma.sql`
            SELECT "id", "seatId", "blockedAt"
            FROM "showtime_seats"
            WHERE "showtimeId" = ${showtimeId}
              AND "seatId" IN (${Prisma.join(uniqueSeatIds)})
            ORDER BY "seatId"
            FOR UPDATE
          `,
        );
        if (rows.length !== uniqueSeatIds.length) throw AppError.notFound("One or more seats do not exist.");
        if (rows.some((row) => row.blockedAt)) throw AppError.conflict("One or more seats are blocked.");

        const now = new Date();
        const inventoryIds = rows.map((row) => row.id);
        const sold = await tx.ticket.findFirst({
          where: {
            showtimeSeatId: { in: inventoryIds },
            status: { notIn: ["REFUNDED", "CANCELED"] },
          },
        });
        if (sold) throw AppError.conflict("One or more seats have already been sold.");
        await tx.seatHold.updateMany({
          where: { showtimeSeatId: { in: inventoryIds }, releasedAt: null, expiresAt: { lte: now } },
          data: { releasedAt: now },
        });
        const active = await tx.seatHold.findMany({
          where: { showtimeSeatId: { in: inventoryIds }, releasedAt: null, expiresAt: { gt: now } },
        });
        const mine = active.filter((hold) => hold.holderKey === holderKey);
        if (active.length && mine.length !== uniqueSeatIds.length) {
          throw AppError.conflict("One or more seats were just held by another guest.");
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
          where: { showtimeSeatId: { in: inventoryIds }, holderKey, releasedAt: null, expiresAt },
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
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const tiers = await tx.priceTier.findMany({
      where: { organizationId, active: true },
      orderBy: { ticketPriceMinor: "asc" },
    });
    const matching = tiers.find((tier) => tier.appliesOnWeekdays.includes(weekday));
    const defaultTier = tiers.find((tier) => tier.appliesOnWeekdays.length === 0);
    if (!matching && !defaultTier) throw AppError.conflict("No active ticket price is configured.");
    return matching ?? defaultTier!;
  }
}
