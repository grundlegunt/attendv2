import { Module } from "@nestjs/common";
import { BoxOfficeController } from "./box-office.controller";
import { BoxOfficeService } from "./box-office.service";
import { CinemaModule } from "../cinema/cinema.module";
import { PaymentsModule } from "../payments/payments.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";

@Module({ imports: [CinemaModule, PaymentsModule], controllers: [BoxOfficeController], providers: [BoxOfficeService, RequestRateLimitGuard], exports: [BoxOfficeService] })
export class BoxOfficeModule {}
