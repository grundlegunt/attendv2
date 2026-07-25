import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { CinemaModule } from "./cinema/cinema.module";

@Module({
  imports: [HealthModule, AuthModule, AuditModule, CinemaModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
