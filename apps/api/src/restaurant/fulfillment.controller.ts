import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Permission } from "@cinema/auth";
import { fulfillmentTicketTransitionRequestSchema } from "@cinema/shared";
import { CurrentActor } from "../auth/decorators/current-actor.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequestActor } from "../auth/types";
import { AppError } from "../common/app-error";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RestaurantService } from "./restaurant.service";
import { FulfillmentEventsService } from "./fulfillment-events.service";

@Controller("fulfillment")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.KitchenStatusUpdate)
export class FulfillmentController {
  constructor(
    private readonly restaurant: RestaurantService,
    private readonly events: FulfillmentEventsService,
  ) {}

  @Get("stations")
  stations(@CurrentActor() actor: RequestActor) {
    return this.restaurant.getFulfillmentStations({
      locationId: this.locationId(actor),
    });
  }

  @Get("stations/:kitchenStationId/queue")
  queue(
    @CurrentActor() actor: RequestActor,
    @Param("kitchenStationId") kitchenStationId: string,
  ) {
    return this.restaurant.getFulfillmentQueue({
      kitchenStationId,
      locationId: this.locationId(actor),
    });
  }

  @Sse("stations/:kitchenStationId/events")
  stationEvents(
    @CurrentActor() actor: RequestActor,
    @Param("kitchenStationId") kitchenStationId: string,
  ): Observable<MessageEvent> {
    return this.events.forStation(this.locationId(actor), kitchenStationId);
  }

  @Patch("tickets/:ticketId")
  transition(
    @CurrentActor() actor: RequestActor,
    @Param("ticketId") ticketId: string,
    @Body(new ZodValidationPipe(fulfillmentTicketTransitionRequestSchema))
    body: unknown,
  ) {
    return this.restaurant.transitionFulfillmentTicket({
      ...fulfillmentTicketTransitionRequestSchema.parse(body),
      ticketId,
      locationId: this.locationId(actor),
      actorId: actor.sub,
    });
  }

  private locationId(actor: RequestActor) {
    if (!actor.locationId) {
      throw AppError.unauthenticated("Staff session is missing its location.");
    }
    return actor.locationId;
  }
}
