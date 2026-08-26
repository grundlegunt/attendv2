import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { DonationCheckoutController } from "./donation-checkout.controller";
import { DonationCheckoutService } from "./donation-checkout.service";

@Module({ imports: [PaymentsModule, NotificationsModule], controllers: [DonationCheckoutController], providers: [DonationCheckoutService, RequestRateLimitGuard], exports: [DonationCheckoutService] })
export class DonationCheckoutModule {}
