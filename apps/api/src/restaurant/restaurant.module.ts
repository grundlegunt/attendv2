import { Module } from "@nestjs/common";
import { RestaurantController } from "./restaurant.controller";
import { MenuController } from "./menu.controller";
import { RestaurantService } from "./restaurant.service";

@Module({
  controllers: [RestaurantController, MenuController],
  providers: [RestaurantService],
})
export class RestaurantModule {}
