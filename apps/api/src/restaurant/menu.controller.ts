import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Permission } from "@cinema/auth";
import {
  createKitchenStationRequestSchema,
  createMenuCategoryRequestSchema,
  createMenuItemRequestSchema,
  createModifierGroupRequestSchema,
  createModifierRequestSchema,
  updateKitchenStationRequestSchema,
  updateMenuCategoryRequestSchema,
  updateMenuItemRequestSchema,
  updateModifierGroupRequestSchema,
  updateModifierRequestSchema,
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
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createKitchenStationRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createKitchenStation({
      ...createKitchenStationRequestSchema.parse(body),
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
    });
  }

  @Patch("stations/:kitchenStationId")
  @RequirePermissions(Permission.MenuEdit)
  updateStation(
    @CurrentActor() actor: RequestActor,
    @Param("kitchenStationId") kitchenStationId: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(updateKitchenStationRequestSchema)) body: unknown,
  ) {
    return this.restaurant.updateKitchenStation({
      kitchenStationId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
      changes: updateKitchenStationRequestSchema.parse(body),
    });
  }

  @Post("categories")
  @RequirePermissions(Permission.MenuEdit)
  category(
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createMenuCategoryRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createMenuCategory({
      ...createMenuCategoryRequestSchema.parse(body),
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
    });
  }

  @Patch("categories/:menuCategoryId")
  @RequirePermissions(Permission.MenuEdit)
  updateCategory(
    @CurrentActor() actor: RequestActor,
    @Param("menuCategoryId") menuCategoryId: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(updateMenuCategoryRequestSchema)) body: unknown,
  ) {
    return this.restaurant.updateMenuCategory({
      menuCategoryId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
      changes: updateMenuCategoryRequestSchema.parse(body),
    });
  }

  @Post("items")
  @RequirePermissions(Permission.MenuEdit)
  item(
    @CurrentActor() actor: RequestActor,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createMenuItemRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createMenuItem({
      ...createMenuItemRequestSchema.parse(body),
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
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
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createModifierGroupRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createModifierGroup({
      ...createModifierGroupRequestSchema.parse(body),
      menuItemId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
    });
  }

  @Patch("modifier-groups/:modifierGroupId")
  @RequirePermissions(Permission.MenuEdit)
  updateModifierGroup(
    @CurrentActor() actor: RequestActor,
    @Param("modifierGroupId") modifierGroupId: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(updateModifierGroupRequestSchema)) body: unknown,
  ) {
    return this.restaurant.updateModifierGroup({
      modifierGroupId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
      changes: updateModifierGroupRequestSchema.parse(body),
    });
  }

  @Post("modifier-groups/:modifierGroupId/modifiers")
  @RequirePermissions(Permission.MenuEdit)
  modifier(
    @CurrentActor() actor: RequestActor,
    @Param("modifierGroupId") modifierGroupId: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(createModifierRequestSchema)) body: unknown,
  ) {
    return this.restaurant.createModifier({
      ...createModifierRequestSchema.parse(body),
      modifierGroupId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
    });
  }

  @Patch("modifiers/:modifierId")
  @RequirePermissions(Permission.MenuEdit)
  updateModifier(
    @CurrentActor() actor: RequestActor,
    @Param("modifierId") modifierId: string,
    @Headers("idempotency-key") requestId: string | undefined,
    @Body(new ZodValidationPipe(updateModifierRequestSchema)) body: unknown,
  ) {
    return this.restaurant.updateModifier({
      modifierId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
      requestId: requestId ?? randomUUID(),
      changes: updateModifierRequestSchema.parse(body),
    });
  }

  private locationId(actor: RequestActor) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return actor.locationId;
  }
}
