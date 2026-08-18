import { Module } from "@nestjs/common";
import { BoxOfficeController } from "./box-office.controller";
import { BoxOfficeService } from "./box-office.service";
import { CinemaModule } from "../cinema/cinema.module";
import { PaymentsModule } from "../payments/payments.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [CinemaModule, PaymentsModule, NotificationsModule], controllers: [BoxOfficeController], providers: [BoxOfficeService, RequestRateLimitGuard], exports: [BoxOfficeService] })
export class BoxOfficeModule {}
