import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Permission } from "@cinema/auth";
import {
  addRestaurantOrderItemRequestSchema,
  createRestaurantOrderRequestSchema,
  combineRestaurantTabsRequestSchema,
  openSeatLinkedTabsRequestSchema,
  openWalkInTabRequestSchema,
  refireFulfillmentTicketRequestSchema,
  removeRestaurantOrderItemRequestSchema,
  sendRestaurantOrderRequestSchema,
  splitRestaurantTabRequestSchema,
  transferRestaurantOrderRequestSchema,
} from "@cinema/shared";
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

  @Get("seats/:showtimeSeatId/detail")
  seatDetail(
    @CurrentActor() actor: RequestActor,
    @Param("showtimeSeatId") showtimeSeatId: string,
  ) {
    return this.restaurant.getSeatDetail({
      showtimeSeatId,
      locationId: this.locationId(actor),
    });
  }

  @Post("walk-in")
  openWalkIn(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(openWalkInTabRequestSchema)) body: unknown,
  ) {
    const locationId = this.locationId(actor);
    const parsed = openWalkInTabRequestSchema.parse(body);
    return this.restaurant.openWalkInTab({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      locationId,
      actorId: actor.sub,
    });
  }

  @Post(":tabId/orders")
  createOrder(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
    @Body(new ZodValidationPipe(createRestaurantOrderRequestSchema)) body: unknown,
  ) {
    const parsed = createRestaurantOrderRequestSchema.parse(body);
    return this.restaurant.createOrder({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      tabId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post("orders/:orderId/items")
  addOrderItem(
    @CurrentActor() actor: RequestActor,
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(addRestaurantOrderItemRequestSchema)) body: unknown,
  ) {
    const parsed = addRestaurantOrderItemRequestSchema.parse(body);
    return this.restaurant.addOrderItem({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      orderId,
      locationId: this.locationId(actor),
    });
  }

  @Post("orders/:orderId/send")
  sendOrder(
    @CurrentActor() actor: RequestActor,
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(sendRestaurantOrderRequestSchema)) body: unknown,
  ) {
    const parsed = sendRestaurantOrderRequestSchema.parse(body);
    return this.restaurant.sendOrder({
      orderId,
      requestId: parsed.requestId ?? randomUUID(),
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post("fulfillment/:ticketId/refire")
  refire(
    @CurrentActor() actor: RequestActor,
    @Param("ticketId") ticketId: string,
    @Body(new ZodValidationPipe(refireFulfillmentTicketRequestSchema)) body: unknown,
  ) {
    const parsed = refireFulfillmentTicketRequestSchema.parse(body);
    return this.restaurant.transitionFulfillmentTicket({
      ticketId,
      requestId: parsed.requestId ?? randomUUID(),
      action: "REFIRE",
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Delete("orders/:orderId/items/:orderItemId")
  removeDraftOrderItem(
    @CurrentActor() actor: RequestActor,
    @Param("orderId") orderId: string,
    @Param("orderItemId") orderItemId: string,
    @Body(new ZodValidationPipe(removeRestaurantOrderItemRequestSchema)) body: unknown,
  ) {
    const parsed = removeRestaurantOrderItemRequestSchema.parse(body);
    return this.restaurant.removeDraftOrderItem({
      orderId,
      orderItemId,
      requestId: parsed.requestId ?? randomUUID(),
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post(":tabId/split")
  @RequirePermissions(Permission.RestaurantOrderTransfer)
  splitTab(
    @CurrentActor() actor: RequestActor,
    @Param("tabId") tabId: string,
    @Body(new ZodValidationPipe(splitRestaurantTabRequestSchema)) body: unknown,
  ) {
    const parsed = splitRestaurantTabRequestSchema.parse(body);
    return this.restaurant.splitTab({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      tabId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post("orders/:orderId/transfer")
  @RequirePermissions(Permission.RestaurantOrderTransfer)
  transferOrder(
    @CurrentActor() actor: RequestActor,
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(transferRestaurantOrderRequestSchema)) body: unknown,
  ) {
    const parsed = transferRestaurantOrderRequestSchema.parse(body);
    return this.restaurant.transferOrder({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      orderId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  @Post(":targetTabId/combine")
  @RequirePermissions(Permission.RestaurantOrderTransfer)
  combineTabs(
    @CurrentActor() actor: RequestActor,
    @Param("targetTabId") targetTabId: string,
    @Body(new ZodValidationPipe(combineRestaurantTabsRequestSchema)) body: unknown,
  ) {
    const parsed = combineRestaurantTabsRequestSchema.parse(body);
    return this.restaurant.combineTabs({
      ...parsed,
      requestId: parsed.requestId ?? randomUUID(),
      targetTabId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  private locationId(actor: RequestActor) {
    if (!actor.locationId) throw AppError.unauthenticated("Staff session is missing its location.");
    return actor.locationId;
  }
}
