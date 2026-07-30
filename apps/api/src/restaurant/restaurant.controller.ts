import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import { openSeatLinkedTabsRequestSchema } from "@cinema/shared";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RestaurantService } from "./restaurant.service";

@Controller("restaurant-tabs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.RestaurantOrderCreate)
export class RestaurantController {
  constructor(private readonly restaurant: RestaurantService) {}

  @Post("seat-linked")
  openSeatLinked(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(openSeatLinkedTabsRequestSchema)) body: unknown,
  ) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    const parsed = openSeatLinkedTabsRequestSchema.parse(body);
    return this.restaurant.openSeatLinkedTabs({
      ...parsed,
      locationId: actor.locationId,
      actorId: actor.sub,
    });
  }

  @Get(":tabId/summary")
  summary(@CurrentActor() actor: RequestActor, @Param("tabId") tabId: string) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return this.restaurant.getSummary({ tabId, locationId: actor.locationId });
  }
}
