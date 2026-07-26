import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import {
  createAuditoriumRequestSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
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

  @Post("movies")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.MovieManage)
  createMovie(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createMovieRequestSchema)) body: unknown,
  ) {
    return this.cinemaService.createMovie(actor, body as ReturnType<typeof createMovieRequestSchema.parse>);
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
}
