import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import {
  createAuditoriumRequestSchema,
  createFilmSeriesRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  updateMovieRequestSchema,
  duplicateAuditoriumRequestSchema,
  updateAuditoriumLayoutRequestSchema,
  updateFilmSeriesRequestSchema,
  updateShowtimeRequestSchema,
} from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CinemaService } from "./cinema.service";

@Controller("cinema")
export class CinemaController {
  constructor(private readonly cinemaService: CinemaService) {}

  @Get("now-playing")
  nowPlaying(@Query("locationId") locationId?: string) {
    return this.cinemaService.nowPlaying(locationId);
  }

  @Get("branding")
  branding(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicBranding(locationId);
  }

  @Get("content")
  content(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicContent(locationId);
  }

  @Get("film-series")
  filmSeries(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicFilmSeries(locationId);
  }

  @Get("menu")
  menu(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicDiningMenu(locationId);
  }

  @Get("movies/:id")
  movieDetail(@Param("id") id: string, @Query("locationId") locationId?: string) {
    return this.cinemaService.publicMovieDetail(id, locationId);
  }

  @Get("showtimes/:id/seats")
  seatAvailability(@Param("id") id: string, @Query("holderKey") holderKey?: string) {
    return this.cinemaService.seatAvailability(id, holderKey);
  }

  @Post("showtimes/:id/holds")
  holdSeats(
    @Param("id") id: string,
    @Body() body: { seatIds?: string[]; holderKey?: string },
  ) {
    return this.cinemaService.holdSeats(id, body.seatIds ?? [], body.holderKey ?? "");
  }

  @Delete("showtimes/:id/holds/:holdToken")
  releaseSeatHold(
    @Param("holdToken") holdToken: string,
    @Body() body: { holderKey?: string },
  ) {
    return this.cinemaService.releaseSeatHold(holdToken, body.holderKey ?? "");
  }

  @Get("admin/bootstrap")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditoriumManage, Permission.MovieManage, Permission.ShowtimeManage)
  adminBootstrap(@CurrentActor() actor: RequestActor) {
    return this.cinemaService.adminBootstrap(actor);
  }

  @Post("auditoriums")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditoriumManage)
  createAuditorium(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createAuditoriumRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createAuditorium(
      actor,
      body as ReturnType<typeof createAuditoriumRequestSchema.parse>,
    );
  }

  @Patch("auditoriums/:id/layout")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditoriumManage)
  updateAuditoriumLayout(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAuditoriumLayoutRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.updateAuditoriumLayout(
      actor,
      id,
      body as ReturnType<typeof updateAuditoriumLayoutRequestSchema.parse>,
    );
  }

  @Post("auditoriums/:id/duplicate")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditoriumManage)
  duplicateAuditorium(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(duplicateAuditoriumRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.duplicateAuditorium(
      actor,
      id,
      body as ReturnType<typeof duplicateAuditoriumRequestSchema.parse>,
    );
  }

  @Delete("auditoriums/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditoriumManage)
  deactivateAuditorium(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.deactivateAuditorium(actor, id);
  }

  @Post("movies")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  createMovie(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createMovieRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createMovie(actor, body as ReturnType<typeof createMovieRequestSchema.parse>);
  }

  @Patch("movies/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  updateMovie(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMovieRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.updateMovie(actor, id, body as ReturnType<typeof updateMovieRequestSchema.parse>);
  }

  @Delete("movies/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  archiveMovie(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.archiveMovie(actor, id);
  }

  @Post("film-series")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  createFilmSeries(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createFilmSeriesRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createFilmSeries(
      actor,
      body as ReturnType<typeof createFilmSeriesRequestSchema.parse>,
    );
  }

  @Patch("film-series/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  updateFilmSeries(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFilmSeriesRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.updateFilmSeries(
      actor,
      id,
      body as ReturnType<typeof updateFilmSeriesRequestSchema.parse>,
    );
  }

  @Delete("film-series/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  archiveFilmSeries(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.archiveFilmSeries(actor, id);
  }

  @Post("showtimes")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  createShowtime(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createShowtimeRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createShowtime(
      actor,
      body as ReturnType<typeof createShowtimeRequestSchema.parse>,
    );
  }

  @Patch("showtimes/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  updateShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateShowtimeRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.updateShowtime(
      actor,
      id,
      body as ReturnType<typeof updateShowtimeRequestSchema.parse>,
    );
  }

  @Delete("showtimes/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  removeShowtime(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.removeShowtime(actor, id);
  }
}
