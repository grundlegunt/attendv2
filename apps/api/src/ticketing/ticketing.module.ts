import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RefundReconciliationService } from "./refund-reconciliation.service";
import { TicketingController } from "./ticketing.controller";
import { TicketingService } from "./ticketing.service";
import { ScanRateLimitGuard } from "./scan-rate-limit.guard";

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [TicketingController],
  providers: [TicketingService, RefundReconciliationService, ScanRateLimitGuard],
})
export class TicketingModule {}
