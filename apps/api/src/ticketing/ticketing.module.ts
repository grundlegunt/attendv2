import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RefundReconciliationService } from "./refund-reconciliation.service";
import { TicketingController } from "./ticketing.controller";
import { TicketingService } from "./ticketing.service";
import { ScanRateLimitGuard } from "./scan-rate-limit.guard";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { GiftCardPurchaseModule } from "../gift-card-purchases/gift-card-purchase.module";
import { TicketReceiptReconciliationService } from "./ticket-receipt-reconciliation.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OptionalCustomerAuthGuard } from "../auth/guards/optional-customer-auth.guard";
import { SmsTicketReconciliationService } from "./sms-ticket-reconciliation.service";
import { DonationCheckoutModule } from "../donation-checkouts/donation-checkout.module";

@Module({
  imports: [PaymentsModule, NotificationsModule, GiftCardPurchaseModule, DonationCheckoutModule],
  controllers: [TicketingController],
  providers: [TicketingService, RefundReconciliationService, TicketReceiptReconciliationService, SmsTicketReconciliationService, ScanRateLimitGuard, RequestRateLimitGuard, JwtAuthGuard, OptionalCustomerAuthGuard],
})
export class TicketingModule {}
