import { Module } from "@nestjs/common";
import { RestaurantController } from "./restaurant.controller";
import { MenuController } from "./menu.controller";
import { FulfillmentController } from "./fulfillment.controller";
import { FulfillmentEventsService } from "./fulfillment-events.service";
import { RestaurantService } from "./restaurant.service";

@Module({
  controllers: [RestaurantController, MenuController, FulfillmentController],
  providers: [RestaurantService, FulfillmentEventsService],
})
export class RestaurantModule {}
