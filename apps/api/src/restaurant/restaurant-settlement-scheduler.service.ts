import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { StructuredLogger } from "../common/logger.service";
import { RestaurantSettlementService } from "./restaurant-settlement.service";

/**
 * Runs the durable fallback for seat-linked tabs whose check was never
 * dropped. RestaurantSettlementService uses row locks and deterministic
 * idempotency keys, so concurrent application instances can safely sweep.
 */
@Injectable()
export class RestaurantSettlementSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new StructuredLogger(
    RestaurantSettlementSchedulerService.name,
  );

  constructor(private readonly settlement: RestaurantSettlementService) {}

  onModuleInit() {
    const { RESTAURANT_SETTLEMENT_INTERVAL_MS: intervalMs } = loadEnv();
    if (intervalMs <= 0) return;

    this.timer = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const processingPayments =
        await this.settlement.reconcileProcessingPayments();
      const fallbackTabs = await this.settlement.runFallback();
      this.logger.log("Restaurant settlement sweep complete.", {
        processingPayments,
        fallbackTabs,
      });
    } catch (error) {
      this.logger.error(
        "Restaurant fallback settlement sweep failed.",
        String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
