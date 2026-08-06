import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditActorType, Prisma, prisma } from "@cinema/database";
import {
  createAuditoriumRequestSchema,
  createFilmSeriesRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  showtimePresentationSchema,
  updateMovieRequestSchema,
  duplicateAuditoriumRequestSchema,
  updateAuditoriumLayoutRequestSchema,
  updateFilmSeriesRequestSchema,
  updateShowtimeRequestSchema,
  validateAdvancedSeatLayout,
  validateSeatLayout,
} from "@cinema/shared";
import type { PublicDiningMenuResponse } from "@cinema/shared";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";

type AuditoriumInput = ReturnType<typeof createAuditoriumRequestSchema.parse>;
type AuditoriumLayoutUpdateInput = ReturnType<typeof updateAuditoriumLayoutRequestSchema.parse>;
type AuditoriumDuplicateInput = ReturnType<typeof duplicateAuditoriumRequestSchema.parse>;
type FilmSeriesInput = ReturnType<typeof createFilmSeriesRequestSchema.parse>;
type FilmSeriesUpdateInput = ReturnType<typeof updateFilmSeriesRequestSchema.parse>;
type MovieInput = ReturnType<typeof createMovieRequestSchema.parse>;
type ShowtimeInput = ReturnType<typeof createShowtimeRequestSchema.parse>;
type MovieUpdateInput = ReturnType<typeof updateMovieRequestSchema.parse>;
type ShowtimeUpdateInput = ReturnType<typeof updateShowtimeRequestSchema.parse>;

@Injectable()
export class CinemaService implements OnModuleInit, OnModuleDestroy {
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
            movies: {
              where: { active: true },
              include: { pairings: { orderBy: { sortOrder: "asc" } } },
              orderBy: { title: "asc" },
            },
            filmSeries: { orderBy: [{ active: "desc" }, { name: "asc" }] },
            priceTiers: { where: { active: true }, orderBy: { ticketPriceMinor: "asc" } },
          },
        },
        menuCategories: {
          where: { active: true },
          include: { items: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!location) throw AppError.notFound("Location not found.");
    const showtimes = await prisma.showtime.findMany({
      where: { auditorium: { locationId, active: true }, startsAt: { gte: new Date(Date.now() - 86400000) } },
      include: { movie: true, auditorium: true, priceTier: true, filmSeries: true },
      orderBy: { startsAt: "asc" },
    });
    return { location, showtimes };
  }

  async createAuditorium(actor: RequestActor, input: AuditoriumInput) {
    const locationId = this.requireLocation(actor);
    const layoutErrors = input.layout
      ? validateAdvancedSeatLayout(input.seats, input.layout)
      : validateSeatLayout(input.seats);
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
                layoutJson: input.layout as Prisma.InputJsonValue | undefined,
                revisions: { create: { version: 1, layoutJson: input.layout as Prisma.InputJsonValue | undefined } },
                seats: {
                  create: input.seats.map((seat) => ({
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

  async updateAuditoriumLayout(actor: RequestActor, id: string, input: AuditoriumLayoutUpdateInput) {
    const locationId = this.requireLocation(actor);
    const layoutErrors = validateAdvancedSeatLayout(input.seats, input.layout);
    if (layoutErrors.length) throw AppError.validationFailed("The seat layout is invalid.", { errors: layoutErrors });

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const auditorium = await tx.auditorium.findFirst({
          where: { id, locationId, active: true },
          include: { seatMap: true },
        });
        if (!auditorium?.seatMap) throw AppError.notFound("Auditorium seat map not found.");
        const beforeVersion = auditorium.seatMap.version;
        const nextVersion = beforeVersion + 1;
        await tx.seat.updateMany({
          where: { seatMapId: auditorium.seatMap.id, active: true },
          data: { active: false },
        });
        await tx.seatMap.update({
          where: { id: auditorium.seatMap.id },
          data: {
            name: input.seatMapName ?? auditorium.seatMap.name,
            version: nextVersion,
            layoutJson: input.layout as Prisma.InputJsonValue,
            revisions: { create: { version: nextVersion, layoutJson: input.layout as Prisma.InputJsonValue } },
            seats: { create: input.seats.map((seat) => ({
              label: seat.label.toUpperCase(), rowLabel: seat.rowLabel.toUpperCase(), number: seat.number,
              x: seat.x, y: seat.y, type: seat.type, layoutVersion: nextVersion,
              tableGroupId: seat.tableGroupId ?? null, tablePosition: seat.tablePosition ?? null,
              levelKey: seat.levelKey ?? null, sectionKey: seat.sectionKey ?? null,
            })) },
          },
        });
        const updated = await tx.auditorium.update({
          where: { id },
          data: { name: input.name ?? auditorium.name, capacity: input.seats.length },
          include: { seatMap: { include: { seats: { where: { active: true }, orderBy: [{ y: "asc" }, { x: "asc" }] } } } },
        });
        await tx.auditEvent.create({ data: {
          actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
          action: "auditorium.layout_version_created", entityType: "Auditorium", entityId: id,
          beforeState: { version: beforeVersion, capacity: auditorium.capacity },
          afterState: { version: nextVersion, capacity: input.seats.length, mode: input.layout.mode },
        } });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("A seat already uses that label or coordinate in this layout version.");
      }
      throw error;
    }
  }

  async duplicateAuditorium(actor: RequestActor, id: string, input: AuditoriumDuplicateInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const source = await tx.auditorium.findFirst({
        where: { id, locationId, active: true },
        include: { seatMap: { include: { seats: { where: { active: true } } } } },
      });
      if (!source?.seatMap) throw AppError.notFound("Auditorium seat map not found.");
      const copy = await tx.auditorium.create({ data: {
        locationId, name: input.name, capacity: source.capacity,
        seatMap: { create: {
          name: `${input.name} layout`, version: 1,
          layoutJson: source.seatMap.layoutJson ?? undefined,
          revisions: { create: { version: 1, layoutJson: source.seatMap.layoutJson ?? undefined } },
          seats: { create: source.seatMap.seats.map((seat) => ({
            label: seat.label, rowLabel: seat.rowLabel, number: seat.number, x: seat.x, y: seat.y,
            type: seat.type, tableGroupId: seat.tableGroupId, tablePosition: seat.tablePosition,
            levelKey: seat.levelKey, sectionKey: seat.sectionKey,
          })) },
        } },
      }, include: { seatMap: { include: { seats: true } } } });
      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
        action: "auditorium.duplicated", entityType: "Auditorium", entityId: copy.id,
        afterState: { sourceAuditoriumId: source.id, name: copy.name, capacity: copy.capacity },
      } });
      return copy;
    });
  }

  async deactivateAuditorium(actor: RequestActor, id: string) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const auditorium = await tx.auditorium.findFirst({ where: { id, locationId, active: true } });
      if (!auditorium) throw AppError.notFound("Auditorium not found.");
      const futureShowtimes = await tx.showtime.count({
        where: { auditoriumId: id, startsAt: { gte: new Date() } },
      });
      if (futureShowtimes) {
        throw AppError.conflict(
          `Remove or move ${futureShowtimes} future showtime${futureShowtimes === 1 ? "" : "s"} before deactivating this auditorium.`,
        );
      }
      const deactivated = await tx.auditorium.update({ where: { id }, data: { active: false } });
      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
        action: "auditorium.deactivated", entityType: "Auditorium", entityId: id,
        beforeState: { active: true, name: auditorium.name, capacity: auditorium.capacity },
        afterState: { active: false },
      } });
      return deactivated;
    });
  }

  async createMovie(actor: RequestActor, input: MovieInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location) throw AppError.notFound("Location not found.");
      await this.validatePairingMenuItems(tx, locationId, input.pairingMenuItemIds);
      const movie = await tx.movie.create({
        data: {
          organizationId: location.organizationId,
          title: input.title,
          synopsis: input.synopsis ?? null,
          runtimeMinutes: input.runtimeMinutes,
          rating: input.rating ?? null,
          posterUrl: input.posterUrl ?? null,
          director: input.director ?? null,
          starring: input.starring ?? null,
          trailerUrl: input.trailerUrl ?? null,
          releaseYear: input.releaseYear ?? null,
          pairings: {
            create: input.pairingMenuItemIds.map((menuItemId, sortOrder) => ({ menuItemId, sortOrder })),
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
            title: movie.title, runtimeMinutes: movie.runtimeMinutes, rating: movie.rating,
            posterUrl: movie.posterUrl, director: movie.director, starring: movie.starring,
            trailerUrl: movie.trailerUrl, releaseYear: movie.releaseYear,
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
      const location = await tx.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
      if (!location) throw AppError.notFound("Location not found.");
      const movie = await tx.movie.findFirst({ where: { id, organizationId: location.organizationId, active: true } });
      if (!movie) throw AppError.notFound("Movie not found.");
      const futureShowtimes = await tx.showtime.count({
        where: { movieId: id, startsAt: { gte: new Date() } },
      });
      if (futureShowtimes) {
        throw AppError.conflict(
          `Remove ${futureShowtimes} future showtime${futureShowtimes === 1 ? "" : "s"} before removing this film from the library.`,
        );
      }
      const archived = await tx.movie.update({ where: { id }, data: { active: false } });
      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, action: "movie.archived",
        entityType: "Movie", entityId: movie.id, locationId,
        beforeState: { active: true, title: movie.title, runtimeMinutes: movie.runtimeMinutes },
        afterState: { active: false },
      } });
      return archived;
    });
  }

  async updateMovie(actor: RequestActor, id: string, input: MovieUpdateInput) {
    const locationId = this.requireLocation(actor);
    return prisma.$transaction(async (tx) => {
      const location = await tx.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
      if (!location) throw AppError.notFound("Location not found.");
      const existing = await tx.movie.findFirst({ where: { id, organizationId: location.organizationId, active: true } });
      if (!existing) throw AppError.notFound("Movie not found.");
      const { pairingMenuItemIds, ...movieFields } = input;
      if (pairingMenuItemIds) await this.validatePairingMenuItems(tx, locationId, pairingMenuItemIds);
      const movie = await tx.movie.update({
        where: { id },
        data: {
          ...movieFields,
          ...(pairingMenuItemIds ? {
            pairings: {
              deleteMany: {},
              create: pairingMenuItemIds.map((menuItemId, sortOrder) => ({ menuItemId, sortOrder })),
            },
          } : {}),
        },
      });
      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE,
        actorId: actor.sub,
        action: "movie.updated",
        entityType: "Movie",
        entityId: movie.id,
        locationId,
        beforeState: {
          title: existing.title, synopsis: existing.synopsis, runtimeMinutes: existing.runtimeMinutes,
          rating: existing.rating, posterUrl: existing.posterUrl, director: existing.director,
          starring: existing.starring, trailerUrl: existing.trailerUrl, releaseYear: existing.releaseYear,
        },
        afterState: {
          title: movie.title, synopsis: movie.synopsis, runtimeMinutes: movie.runtimeMinutes,
          rating: movie.rating, posterUrl: movie.posterUrl, director: movie.director,
          starring: movie.starring, trailerUrl: movie.trailerUrl, releaseYear: movie.releaseYear,
          ...(pairingMenuItemIds ? { pairingMenuItemIds } : {}),
        },
      } });
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
      where: { id: { in: menuItemIds }, active: true, menuCategory: { locationId } },
    });
    if (count !== menuItemIds.length) throw AppError.notFound("One or more pairing menu items were not found.");
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
          },
        });
        await tx.auditEvent.create({ data: {
          actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
          action: "film_series.created", entityType: "FilmSeries", entityId: filmSeries.id,
          afterState: { name: filmSeries.name, active: filmSeries.active },
        } });
        return filmSeries;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("A film series already uses that name.");
      }
      throw error;
    }
  }

  async updateFilmSeries(actor: RequestActor, id: string, input: FilmSeriesUpdateInput) {
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
        const filmSeries = await tx.filmSeries.update({ where: { id }, data: input });
        await tx.auditEvent.create({ data: {
          actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
          action: "film_series.updated", entityType: "FilmSeries", entityId: filmSeries.id,
          beforeState: { name: existing.name, description: existing.description, artworkUrl: existing.artworkUrl, active: existing.active },
          afterState: { name: filmSeries.name, description: filmSeries.description, artworkUrl: filmSeries.artworkUrl, active: filmSeries.active },
        } });
        return filmSeries;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
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
        if (!auditorium.capacity) throw AppError.conflict("Auditorium must have a seat layout.");

        const movie = await tx.movie.findFirst({
          where: { id: input.movieId, organizationId: auditorium.location.organizationId, active: true },
        });
        if (!movie) throw AppError.notFound("Movie not found.");

        const filmSeries = input.filmSeriesId
          ? await tx.filmSeries.findFirst({
              where: { id: input.filmSeriesId, organizationId: auditorium.location.organizationId, active: true },
            })
          : null;
        if (input.filmSeriesId && !filmSeries) throw AppError.notFound("Film series not found.");

        const startsAt = new Date(input.startsAt);
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
        const cleaningMinutes = Math.max(this.minimumCinemaCleaningMinutes, auditorium.location.cleaningBufferMinutes);
        const roomReadyAt = new Date(endsAt.getTime() + cleaningMinutes * 60000);
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
            filmSeriesId: filmSeries?.id ?? null,
            presentation: input.presentation,
            format: input.format ?? null,
          },
          include: { movie: true, auditorium: true, priceTier: true, filmSeries: true },
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
              filmSeriesId: filmSeries?.id ?? null,
              presentation: input.presentation,
              format: input.format ?? null,
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

        const filmSeriesId = input.filmSeriesId === undefined ? existing.filmSeriesId : input.filmSeriesId;
        if (filmSeriesId && filmSeriesId !== existing.filmSeriesId) {
          const filmSeries = await tx.filmSeries.findFirst({
            where: { id: filmSeriesId, organizationId: auditorium.location.organizationId, active: true },
          });
          if (!filmSeries) throw AppError.notFound("Film series not found.");
        }

        const startsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
        const featureStartsAt = new Date(
          startsAt.getTime() + auditorium.location.preShowBufferMinutes * 60000,
        );
        const endsAt = new Date(featureStartsAt.getTime() + movie.runtimeMinutes * 60000);
        const cleaningMinutes = Math.max(this.minimumCinemaCleaningMinutes, auditorium.location.cleaningBufferMinutes);
        const roomReadyAt = new Date(endsAt.getTime() + cleaningMinutes * 60000);
        const priceTier = input.priceTierId === undefined
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
          include: { movie: true, auditorium: true, priceTier: true, filmSeries: true },
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
              format: input.format === undefined ? existing.format : input.format,
            },
          },
        });
        return showtime;
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
        throw AppError.conflict("Past or already-started showtimes are retained for reporting and cannot be removed.");
      }

      const now = new Date();
      const [tickets, restaurantTabs, restaurantOrders, activeSeatHolds] = await Promise.all([
        tx.ticket.count({ where: { showtimeSeat: { showtimeId: id } } }),
        tx.restaurantTab.count({ where: { showtimeId: id } }),
        tx.restaurantOrder.count({ where: { showtimeSeat: { showtimeId: id } } }),
        tx.seatHold.count({
          where: {
            showtimeSeat: { showtimeId: id },
            releasedAt: null,
            expiresAt: { gt: now },
          },
        }),
      ]);
      if (tickets) {
        throw AppError.conflict("This showtime has ticket records. Cancel or refund affected tickets instead of removing it.");
      }
      if (restaurantTabs || restaurantOrders) {
        throw AppError.conflict("This showtime has restaurant activity and must be retained for operations and reporting.");
      }
      if (activeSeatHolds) {
        throw AppError.conflict("This showtime has active seat holds. Close sales and wait for the holds to expire before removing it.");
      }

      await tx.auditEvent.create({ data: {
        actorType: AuditActorType.EMPLOYEE, actorId: actor.sub, locationId,
        action: "showtime.removed", entityType: "Showtime", entityId: id,
        beforeState: {
          movieId: showtime.movieId, movieTitle: showtime.movie.title,
          auditoriumId: showtime.auditoriumId, auditoriumName: showtime.auditorium.name,
          startsAt: showtime.startsAt.toISOString(), onSale: showtime.onSale,
        },
        afterState: { removed: true },
      } });
      await tx.showtime.delete({ where: { id } });
      return { id, removed: true };
    });
  }

  async publicBranding(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
    if (!location) throw AppError.notFound("Location not found.");
    return {
      locationId: location.id,
      name: location.name,
      logoUrl: location.customerLogoUrl,
      accentColor: location.customerAccentColor,
      accentMutedColor: location.customerAccentMutedColor,
      backgroundColor: location.customerBackgroundColor,
      surfaceColor: location.customerSurfaceColor,
      textColor: location.customerTextColor,
      mutedTextColor: location.customerMutedTextColor,
    };
  }

  async nowPlaying(locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
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
            format: true,
            filmSeries: { select: { id: true, name: true } },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: {
              select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true },
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

  async publicDiningMenu(locationId?: string): Promise<PublicDiningMenuResponse> {
    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
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
              id: true, name: true, description: true, imageUrl: true,
              priceCents: true, isVegan: true, isGlutenFree: true,
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
          pairings: { some: { menuItem: { active: true, is86d: false, menuCategory: { locationId: location.id, active: true } } } },
        },
        select: {
          id: true,
          title: true,
          posterUrl: true,
          pairings: {
            where: { menuItem: { active: true, is86d: false, menuCategory: { locationId: location.id, active: true } } },
            select: {
              menuItem: {
                select: {
                  id: true, name: true, description: true, imageUrl: true,
                  priceCents: true, isVegan: true, isGlutenFree: true,
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
      location: { id: location.id, name: location.name, address: location.address },
      categories,
      movieSpecials: movies.map((movie) => ({
        movieId: movie.id,
        movieTitle: movie.title,
        posterUrl: movie.posterUrl,
        items: movie.pairings.map((pairing) => pairing.menuItem),
      })),
    };
  }

  async publicMovieDetail(id: string, locationId?: string) {
    const location = locationId
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
    if (!location) throw AppError.notFound("Location not found.");
    const movie = await prisma.movie.findFirst({
      where: { id, organizationId: location.organizationId, active: true },
      include: {
        showtimes: {
          where: { onSale: true, startsAt: { gte: new Date() }, auditorium: { locationId: location.id } },
          select: {
            id: true,
            startsAt: true,
            format: true,
            filmSeries: { select: { id: true, name: true } },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: { select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true } },
          },
          orderBy: { startsAt: "asc" },
        },
        pairings: {
          where: { menuItem: { active: true, is86d: false, menuCategory: { locationId: location.id } } },
          include: { menuItem: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!movie) throw AppError.notFound("Movie not found.");
    return {
      location: { id: location.id, name: location.name, timezone: location.timezone },
      movie: {
        id: movie.id,
        title: movie.title,
        synopsis: movie.synopsis,
        runtimeMinutes: movie.runtimeMinutes,
        rating: movie.rating,
        posterUrl: movie.posterUrl,
        director: movie.director,
        starring: movie.starring,
        trailerUrl: movie.trailerUrl,
        releaseYear: movie.releaseYear,
        showtimes: movie.showtimes.map((showtime) => ({ ...showtime, startsAt: showtime.startsAt.toISOString() })),
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
      ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
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
                id: true, title: true, synopsis: true, runtimeMinutes: true, rating: true, posterUrl: true,
                director: true, starring: true, trailerUrl: true, releaseYear: true,
              },
            },
            auditorium: { select: { id: true, name: true, capacity: true } },
            priceTier: { select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true } },
          },
          orderBy: { startsAt: "asc" },
        },
      },
    });

    return {
      location: { id: location.id, name: location.name, address: location.address, timezone: location.timezone },
      series: series
        .map((entry) => {
          const movies = new Map<string, {
            id: string; title: string; synopsis: string | null; runtimeMinutes: number;
            rating: string | null; posterUrl: string | null; director: string | null;
            starring: string | null; trailerUrl: string | null; releaseYear: number | null; showtimes: Array<{
              id: string; startsAt: string; presentation: "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
              format: string | null; filmSeries: { id: string; name: string } | null;
              auditorium: { id: string; name: string; capacity: number };
              priceTier: { name: string; ticketPriceMinor: number; feeMinor: number; currency: string };
            }>;
          }>();
          for (const showtime of entry.showtimes) {
            const movie = movies.get(showtime.movie.id) ?? { ...showtime.movie, showtimes: [] };
            movie.showtimes.push({
              id: showtime.id,
              startsAt: showtime.startsAt.toISOString(),
              presentation: showtimePresentationSchema.parse(showtime.presentation),
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
            firstShowtimeAt: entry.showtimes[0]?.startsAt.getTime() ?? Infinity,
          };
        })
        .sort((a, b) => a.firstShowtimeAt - b.firstShowtimeAt)
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
          holdToken: hold && holderKey && hold.holderKey === holderKey ? hold.holdToken : undefined,
          expiresAt: hold && holderKey && hold.holderKey === holderKey
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
