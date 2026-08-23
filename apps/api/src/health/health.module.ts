import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Module({
  controllers: [HealthController],
  providers: [RequestRateLimitGuard],
})
export class HealthModule {}
