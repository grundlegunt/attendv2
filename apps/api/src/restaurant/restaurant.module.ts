import { Module } from "@nestjs/common";
import { RestaurantController } from "./restaurant.controller";
import { MenuController } from "./menu.controller";
import { FulfillmentController } from "./fulfillment.controller";
import { FulfillmentEventsService } from "./fulfillment-events.service";
import { RestaurantService } from "./restaurant.service";
import {
  CustomerRestaurantTabController,
  PublicRestaurantTabController,
  RestaurantSettlementController,
} from "./restaurant-settlement.controller";
import { RestaurantSettlementService } from "./restaurant-settlement.service";
import { RestaurantSettlementSchedulerService } from "./restaurant-settlement-scheduler.service";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [
    RestaurantController,
    MenuController,
    FulfillmentController,
    RestaurantSettlementController,
    CustomerRestaurantTabController,
    PublicRestaurantTabController,
  ],
  providers: [
    RestaurantService,
    FulfillmentEventsService,
    RestaurantSettlementService,
    RestaurantSettlementSchedulerService,
  ],
})
export class RestaurantModule {}
