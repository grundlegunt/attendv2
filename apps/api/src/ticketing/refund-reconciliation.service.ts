import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { StructuredLogger } from "../common/logger.service";
import { TicketingService } from "./ticketing.service";

/**
 * Periodically calls TicketingService.reconcilePendingRefunds so a refund
 * whose owning request died before (or just after) calling the payment
 * provider doesn't stay stuck in CREATED/PROCESSING forever. This is the
 * durable fallback alongside the real-time refund.updated webhook handling
 * in TicketingService.processWebhook -- see
 * packages/ticketing/src/ticketing-service.ts's reconcilePendingRefunds doc
 * comment for the full reasoning (lease-based claiming makes concurrent
 * sweeps, and a sweep overlapping a live refund call, safe).
 *
 * Set REFUND_RECONCILIATION_INTERVAL_MS=0 to disable the sweep (e.g. tests
 * that drive reconciliation explicitly and don't want a background timer
 * racing them).
 */
@Injectable()
export class RefundReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new StructuredLogger(RefundReconciliationService.name);

  constructor(private readonly ticketingService: TicketingService) {}

  onModuleInit() {
    const { REFUND_RECONCILIATION_INTERVAL_MS: intervalMs } = loadEnv();
    if (intervalMs <= 0) return;

    this.timer = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSweep(): Promise<void> {
    // A sweep that takes longer than the interval must not overlap itself
    // -- reconcilePendingRefunds is safe to call concurrently with other
    // processes (lease claiming), but there is no reason for a single
    // process to run two passes at once.
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.ticketingService.reconcilePendingRefunds();
      this.logger.log("Refund reconciliation sweep complete.", result);
    } catch (error) {
      this.logger.error("Refund reconciliation sweep failed.", String(error));
    } finally {
      this.running = false;
    }
  }
}
