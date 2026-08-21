import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RefundReconciliationService } from "./refund-reconciliation.service";
import { TicketingController } from "./ticketing.controller";
import { TicketingService } from "./ticketing.service";
import { ScanRateLimitGuard } from "./scan-rate-limit.guard";
import { RequestRateLimitGuard } from "../common/request-rate-limit.guard";
import { GiftCardPurchaseModule } from "../gift-card-purchases/gift-card-purchase.module";

@Module({
  imports: [PaymentsModule, NotificationsModule, GiftCardPurchaseModule],
  controllers: [TicketingController],
  providers: [TicketingService, RefundReconciliationService, ScanRateLimitGuard, RequestRateLimitGuard],
})
export class TicketingModule {}
