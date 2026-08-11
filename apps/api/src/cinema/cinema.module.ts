import { Module } from "@nestjs/common";
import { CinemaController } from "./cinema.controller";
import { CinemaService } from "./cinema.service";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Module({
  controllers: [CinemaController],
  providers: [CinemaService, RequestRateLimitGuard],
  exports: [CinemaService],
})
export class CinemaModule {}
