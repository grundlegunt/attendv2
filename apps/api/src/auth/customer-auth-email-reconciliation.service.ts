import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { StructuredLogger } from "../common/logger.service";
import { AuthService } from "./auth.service";

@Injectable()
export class CustomerAuthEmailReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new StructuredLogger(CustomerAuthEmailReconciliationService.name);

  constructor(private readonly auth: AuthService) {}

  onModuleInit() {
    const { CUSTOMER_AUTH_EMAIL_RECONCILIATION_INTERVAL_MS: intervalMs } = loadEnv();
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
      const result = await this.auth.reconcileCustomerPasswordResetEmails();
      this.logger.log("Customer auth email reconciliation sweep complete.", result);
    } catch (error) {
      this.logger.error("Customer auth email reconciliation sweep failed.", String(error));
    } finally {
      this.running = false;
    }
  }
}
