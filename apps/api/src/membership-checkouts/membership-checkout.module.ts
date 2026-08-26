import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { MembershipCheckoutController } from "./membership-checkout.controller";
import { MembershipCheckoutService } from "./membership-checkout.service";

@Module({ imports: [PaymentsModule, NotificationsModule], controllers: [MembershipCheckoutController], providers: [MembershipCheckoutService, RequestRateLimitGuard], exports: [MembershipCheckoutService] })
export class MembershipCheckoutModule {}
