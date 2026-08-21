import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { StructuredLogger } from "../common/logger.service";
import { GiftCardPurchaseService } from "./gift-card-purchase.service";

@Injectable()
export class GiftCardDeliveryReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new StructuredLogger(GiftCardDeliveryReconciliationService.name);

  constructor(private readonly purchases: GiftCardPurchaseService) {}

  onModuleInit() {
    const { GIFT_CARD_DELIVERY_RECONCILIATION_INTERVAL_MS: intervalMs } = loadEnv();
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => { void this.runSweep(); }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.purchases.reconcileFailedDeliveries();
      this.logger.log("Gift-card delivery reconciliation sweep complete.", result);
    } catch (error) {
      this.logger.error("Gift-card delivery reconciliation sweep failed.", String(error));
    } finally {
      this.running = false;
    }
  }
}
