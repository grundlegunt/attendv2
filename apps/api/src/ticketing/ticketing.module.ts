import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { RefundReconciliationService } from "./refund-reconciliation.service";
import { TicketingController } from "./ticketing.controller";
import { TicketingService } from "./ticketing.service";

@Module({
  imports: [PaymentsModule],
  controllers: [TicketingController],
  providers: [TicketingService, RefundReconciliationService],
})
export class TicketingModule {}
