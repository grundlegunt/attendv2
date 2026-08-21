import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { StructuredLogger } from "../common/logger.service";
import { TicketingService } from "./ticketing.service";

@Injectable()
export class TicketReceiptReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new StructuredLogger(TicketReceiptReconciliationService.name);

  constructor(private readonly ticketing: TicketingService) {}

  onModuleInit() {
    const { TICKET_RECEIPT_RECONCILIATION_INTERVAL_MS: intervalMs } = loadEnv();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => void this.runSweep(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.ticketing.reconcileFailedReceipts();
      this.logger.log("Ticket receipt reconciliation sweep complete.", result);
    } catch (error) {
      this.logger.error("Ticket receipt reconciliation sweep failed.", String(error));
    } finally {
      this.running = false;
    }
  }
}
