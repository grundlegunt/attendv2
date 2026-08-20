import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Permission } from "@cinema/auth";
import {
  createAuditoriumRequestSchema,
  createFilmSeriesRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  duplicateShowtimeDayRequestSchema,
  moveShowtimeGroupRequestSchema,
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
import { RateLimit, RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { CinemaService } from "./cinema.service";

const giftCardBalanceSchema = z.object({ code: z.string().trim().min(20).max(40) }).strict();
const createSchedulePlanSchema = z.object({ name: z.string().trim().min(1).max(80), weekStartsAt: z.string().datetime() }).strict();
const duplicateSchedulePlanSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const renameSchedulePlanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expectedName: z.string().min(1).max(80),
}).strict();
const updateSchedulePlanShowtimeSchema = z.object({
  startsAt: z.string().datetime(),
  expectedStartsAt: z.string().datetime(),
}).strict();
const publishSchedulePlanSchema = z.object({ expectedUpdatedAt: z.string().datetime() }).strict();

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

  @Get("admin-branding")
  adminBranding(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicAdminBranding(locationId);
  }

  @Get("content")
  content(@Query("locationId") locationId?: string) {
    return this.cinemaService.publicContent(locationId);
  }

  @Post("private-event-inquiries")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout", identity: "email" })
  privateEventInquiry(@Query("locationId") locationId: string | undefined, @Headers("idempotency-key") requestId: string | undefined, @Body(new ZodValidationPipe(z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200), phone: z.string().trim().max(40).optional(), eventType: z.string().trim().min(1).max(100), preferredDate: z.string().datetime().optional(), guestCount: z.number().int().min(1).max(5000).optional(), message: z.string().trim().min(1).max(2000) }).strict())) body: unknown) { return this.cinemaService.createPrivateEventInquiry(locationId, body as never, requestId); }

  @Post("gift-cards/balance")
  @UseGuards(RequestRateLimitGuard)
  @RateLimit({ scope: "checkout" })
  giftCardBalance(@Query("locationId") locationId: string | undefined, @Body(new ZodValidationPipe(giftCardBalanceSchema)) body: unknown) { return this.cinemaService.giftCardBalance(locationId, giftCardBalanceSchema.parse(body).code); }

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

  @Get("schedule-plans")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  schedulePlans(@CurrentActor() actor: RequestActor) {
    return this.cinemaService.schedulePlans(actor);
  }

  @Post("schedule-plans")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  createSchedulePlan(
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createSchedulePlanSchema)) body: unknown,
  ) {
    return this.cinemaService.createSchedulePlan(
      actor,
      createSchedulePlanSchema.parse(body),
      requestId,
    );
  }

  @Post("schedule-plans/:id/validate")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  validateSchedulePlan(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.validateSchedulePlan(actor, id);
  }

  @Post("schedule-plans/:id/publish")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  publishSchedulePlan(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(publishSchedulePlanSchema)) body: unknown,
  ) {
    return this.cinemaService.publishSchedulePlan(
      actor,
      id,
      publishSchedulePlanSchema.parse(body).expectedUpdatedAt,
      requestId,
    );
  }

  @Post("schedule-plans/:id/duplicate")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  duplicateSchedulePlan(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(duplicateSchedulePlanSchema)) body: unknown,
  ) {
    return this.cinemaService.duplicateSchedulePlan(
      actor,
      id,
      duplicateSchedulePlanSchema.parse(body).name,
      requestId,
    );
  }

  @Post("schedule-plans/:id/showtimes")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  addSchedulePlanShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createShowtimeRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.addSchedulePlanShowtime(
      actor,
      id,
      createShowtimeRequestSchema.parse(body),
      requestId,
    );
  }

  @Patch("schedule-plans/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  renameSchedulePlan(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(renameSchedulePlanSchema)) body: unknown,
  ) {
    const input = renameSchedulePlanSchema.parse(body);
    return this.cinemaService.renameSchedulePlan(
      actor,
      id,
      input.name,
      input.expectedName,
      requestId,
    );
  }

  @Delete("schedule-plans/:id/showtimes/:index")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  removeSchedulePlanShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Param("index") index: string,
    @Headers("idempotency-key") requestId: string | undefined,
  ) {
    return this.cinemaService.removeSchedulePlanShowtime(
      actor,
      id,
      Number(index),
      requestId,
    );
  }

  @Patch("schedule-plans/:id/showtimes/:index")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  updateSchedulePlanShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Param("index") index: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(updateSchedulePlanShowtimeSchema)) body: unknown,
  ) {
    const input = updateSchedulePlanShowtimeSchema.parse(body);
    return this.cinemaService.updateSchedulePlanShowtime(
      actor,
      id,
      Number(index),
      input.startsAt,
      input.expectedStartsAt,
      requestId,
    );
  }

  @Delete("schedule-plans/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  deleteSchedulePlan(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
  ) {
    return this.cinemaService.deleteSchedulePlan(actor, id, requestId);
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

  @Delete("movies/:id/permanent")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  permanentlyDeleteMovie(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.permanentlyDeleteMovie(actor, id);
  }

  @Post("movies/:id/restore")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  restoreMovie(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.cinemaService.restoreMovie(actor, id);
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
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createShowtimeRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createShowtime(
      actor,
      body as ReturnType<typeof createShowtimeRequestSchema.parse>,
      requestId,
    );
  }

  @Post("showtimes/duplicate-day")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  duplicateShowtimeDay(
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(duplicateShowtimeDayRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.duplicateShowtimeDay(
      actor,
      body as ReturnType<typeof duplicateShowtimeDayRequestSchema.parse>,
      requestId,
    );
  }

  @Patch("showtimes/group")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  moveShowtimeGroup(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(moveShowtimeGroupRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.moveShowtimeGroup(
      actor,
      body as ReturnType<typeof moveShowtimeGroupRequestSchema.parse>,
    );
  }

  @Patch("showtimes/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  updateShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Headers("if-unmodified-since") expectedUpdatedAt: string | undefined,
    @Body(new ZodValidationPipe(updateShowtimeRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.updateShowtime(
      actor,
      id,
      body as ReturnType<typeof updateShowtimeRequestSchema.parse>,
      requestId,
      expectedUpdatedAt,
    );
  }

  @Delete("showtimes/:id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ShowtimeManage)
  removeShowtime(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Headers("idempotency-key") requestId: string | undefined,
  ) {
    return this.cinemaService.removeShowtime(actor, id, requestId);
  }
}
