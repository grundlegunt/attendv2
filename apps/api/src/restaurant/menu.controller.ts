import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Permission } from "@cinema/auth";
import {
  createKitchenStationRequestSchema,
  createMenuCategoryRequestSchema,
  createMenuItemRequestSchema,
  createModifierGroupRequestSchema,
  createModifierRequestSchema,
  updateMenuItemRequestSchema,
} from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RestaurantService } from "./restaurant.service";

@Controller("restaurant-menu")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuController {
  constructor(private readonly restaurant: RestaurantService) {}

  @Get()
  @RequirePermissions(Permission.RestaurantOrderCreate)
  menu(@CurrentActor() actor: RequestActor) {
    return this.restaurant.getMenu({ locationId: this.locationId(actor) });
  }

  @Get("admin")
  @RequirePermissions(Permission.MenuEdit)
  adminMenu(@CurrentActor() actor: RequestActor) {
    return this.restaurant.getMenu({
      locationId: this.locationId(actor),
      includeInactive: true,
    });
  }

  @Post("stations")
  @RequirePermissions(Permission.MenuEdit)
  station(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createKitchenStationRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createKitchenStation({
      ...createKitchenStationRequestSchema.parse(body),
      locationId: this.locationId(actor),
    });
  }

  @Post("categories")
  @RequirePermissions(Permission.MenuEdit)
  category(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createMenuCategoryRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createMenuCategory({
      ...createMenuCategoryRequestSchema.parse(body),
      locationId: this.locationId(actor),
    });
  }

  @Post("items")
  @RequirePermissions(Permission.MenuEdit)
  item(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createMenuItemRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createMenuItem({
      ...createMenuItemRequestSchema.parse(body),
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Patch("items/:menuItemId")
  @RequirePermissions(Permission.MenuEdit)
  updateItem(
    @CurrentActor() actor: RequestActor,
    @Param("menuItemId") menuItemId: string,
    @Body(new ZodValidationPipe(updateMenuItemRequestSchema)) body: unknown,
  ) {
    return this.restaurant.updateMenuItem({
      menuItemId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      changes: updateMenuItemRequestSchema.parse(body),
    });
  }

  @Post("items/:menuItemId/modifier-groups")
  @RequirePermissions(Permission.MenuEdit)
  modifierGroup(
    @CurrentActor() actor: RequestActor,
    @Param("menuItemId") menuItemId: string,
    @Body(new ZodValidationPipe(createModifierGroupRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createModifierGroup({
      ...createModifierGroupRequestSchema.parse(body),
      menuItemId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post("modifier-groups/:modifierGroupId/modifiers")
  @RequirePermissions(Permission.MenuEdit)
  modifier(
    @CurrentActor() actor: RequestActor,
    @Param("modifierGroupId") modifierGroupId: string,
    @Body(new ZodValidationPipe(createModifierRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createModifier({
      ...createModifierRequestSchema.parse(body),
      modifierGroupId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  private locationId(actor: RequestActor) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return actor.locationId;
  }
}
