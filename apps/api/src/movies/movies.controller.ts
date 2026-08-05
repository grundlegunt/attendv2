import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { CreateMovieInput, CreateMovieSchema, UpdateMovieInput, UpdateMovieSchema } from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MoviesService } from "./movies.service";

@Controller("movies")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Get()
  @RequirePermissions(Permission.MovieManage)
  list(@CurrentActor() actor: RequestActor) {
    return this.moviesService.list(actor);
  }

  @Get(":id")
  @RequirePermissions(Permission.MovieManage)
  get(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.moviesService.get(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.MovieManage)
  create(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(CreateMovieSchema)) input: CreateMovieInput,
  ) {
    return this.moviesService.create(actor, input);
  }

  @Patch(":id")
  @RequirePermissions(Permission.MovieManage)
  update(
    @CurrentActor() actor: RequestActor,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateMovieSchema)) input: UpdateMovieInput,
  ) {
    return this.moviesService.update(actor, id, input);
  }

  @Delete(":id")
  @RequirePermissions(Permission.MovieManage)
  archive(@CurrentActor() actor: RequestActor, @Param("id") id: string) {
    return this.moviesService.archive(actor, id);
  }
}
