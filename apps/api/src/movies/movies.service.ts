import { Injectable } from "@nestjs/common";
import { AuditActorType, Movie, MovieStatus, Prisma, prisma } from "@cinema/database";
import { CreateMovieInput, MovieResponse, UpdateMovieInput } from "@cinema/shared";
import { AuditService } from "../audit/audit.service";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";

@Injectable()
export class MoviesService {
  constructor(private readonly auditService: AuditService) {}

  async list(actor: RequestActor): Promise<MovieResponse[]> {
    const organizationId = await this.organizationIdFor(actor);
    const movies = await prisma.movie.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { title: "asc" }],
    });
    return movies.map(toMovieResponse);
  }

  async get(actor: RequestActor, id: string): Promise<MovieResponse> {
    const organizationId = await this.organizationIdFor(actor);
    return toMovieResponse(await this.findScopedMovie(organizationId, id));
  }

  async create(actor: RequestActor, input: CreateMovieInput): Promise<MovieResponse> {
    const organizationId = await this.organizationIdFor(actor);
    const movie = await prisma.$transaction(async (tx) => {
      const created = await tx.movie.create({
        data: {
          organizationId,
          title: input.title,
          rating: input.rating,
          runtimeMinutes: input.runtimeMinutes,
          synopsis: input.synopsis,
          posterImageUrl: input.posterImageUrl,
          status: input.status as MovieStatus,
        },
      });
      await this.auditService.record(
        {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.created",
          entityType: "Movie",
          entityId: created.id,
          locationId: actor.locationId,
          afterState: movieAuditState(created),
        },
        tx,
      );
      return created;
    });
    return toMovieResponse(movie);
  }

  async update(actor: RequestActor, id: string, input: UpdateMovieInput): Promise<MovieResponse> {
    const organizationId = await this.organizationIdFor(actor);
    const movie = await prisma.$transaction(async (tx) => {
      const existing = await tx.movie.findFirst({ where: { id, organizationId } });
      if (!existing) throw AppError.notFound("Movie not found.");

      const updated = await tx.movie.update({
        where: { id },
        data: {
          title: input.title,
          rating: input.rating,
          runtimeMinutes: input.runtimeMinutes,
          synopsis: input.synopsis,
          posterImageUrl: input.posterImageUrl,
          status: input.status as MovieStatus | undefined,
        },
      });
      await this.auditService.record(
        {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.updated",
          entityType: "Movie",
          entityId: updated.id,
          locationId: actor.locationId,
          beforeState: movieAuditState(existing),
          afterState: movieAuditState(updated),
        },
        tx,
      );
      return updated;
    });
    return toMovieResponse(movie);
  }

  async archive(actor: RequestActor, id: string): Promise<MovieResponse> {
    const organizationId = await this.organizationIdFor(actor);
    const movie = await prisma.$transaction(async (tx) => {
      const existing = await tx.movie.findFirst({ where: { id, organizationId } });
      if (!existing) throw AppError.notFound("Movie not found.");
      if (existing.status === MovieStatus.ARCHIVED) return existing;

      const archived = await tx.movie.update({ where: { id }, data: { status: MovieStatus.ARCHIVED } });
      await this.auditService.record(
        {
          actorType: AuditActorType.EMPLOYEE,
          actorId: actor.sub,
          action: "movie.archived",
          entityType: "Movie",
          entityId: archived.id,
          locationId: actor.locationId,
          beforeState: movieAuditState(existing),
          afterState: movieAuditState(archived),
        },
        tx,
      );
      return archived;
    });
    return toMovieResponse(movie);
  }

  private async organizationIdFor(actor: RequestActor): Promise<string> {
    if (actor.actorType !== "EMPLOYEE" || !actor.locationId) throw AppError.forbidden();
    const location = await prisma.location.findUnique({
      where: { id: actor.locationId },
      select: { organizationId: true },
    });
    if (!location) throw AppError.forbidden();
    return location.organizationId;
  }

  private async findScopedMovie(organizationId: string, id: string): Promise<Movie> {
    const movie = await prisma.movie.findFirst({ where: { id, organizationId } });
    if (!movie) throw AppError.notFound("Movie not found.");
    return movie;
  }
}

function toMovieResponse(movie: Movie): MovieResponse {
  return {
    id: movie.id,
    title: movie.title,
    rating: movie.rating,
    runtimeMinutes: movie.runtimeMinutes,
    synopsis: movie.synopsis,
    posterImageUrl: movie.posterImageUrl,
    status: movie.status,
    createdAt: movie.createdAt.toISOString(),
    updatedAt: movie.updatedAt.toISOString(),
  };
}

function movieAuditState(movie: Movie): Prisma.InputJsonObject {
  return {
    title: movie.title,
    rating: movie.rating,
    runtimeMinutes: movie.runtimeMinutes,
    synopsis: movie.synopsis,
    posterImageUrl: movie.posterImageUrl,
    status: movie.status,
  };
}
