import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { CinemaModule } from "./cinema/cinema.module";
import { TicketingModule } from "./ticketing/ticketing.module";
import { RestaurantModule } from "./restaurant/restaurant.module";

@Module({
  imports: [HealthModule, AuthModule, AuditModule, CinemaModule, TicketingModule, RestaurantModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
