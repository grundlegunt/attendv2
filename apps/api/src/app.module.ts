import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { CinemaModule } from "./cinema/cinema.module";
import { TicketingModule } from "./ticketing/ticketing.module";
import { RestaurantModule } from "./restaurant/restaurant.module";
import { WorkforceModule } from "./workforce/workforce.module";
import { BoxOfficeModule } from "./box-office/box-office.module";
import { ReportingModule } from "./reporting/reporting.module";
import { ManagementModule } from "./management/management.module";
import { PlatformModule } from "./platform/platform.module";

@Module({
  imports: [HealthModule, AuthModule, AuditModule, CinemaModule, TicketingModule, RestaurantModule, WorkforceModule, BoxOfficeModule, ReportingModule, ManagementModule, PlatformModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
