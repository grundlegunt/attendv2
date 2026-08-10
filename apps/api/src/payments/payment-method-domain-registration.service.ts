import { Injectable, OnModuleInit } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { prisma } from "@cinema/database";
import { registerConnectedAccountPaymentMethodDomains } from "@cinema/payments";
import { StructuredLogger } from "../common/logger.service";

@Injectable()
export class PaymentMethodDomainRegistrationService implements OnModuleInit {
  private readonly logger = new StructuredLogger(
    PaymentMethodDomainRegistrationService.name,
  );

  async onModuleInit() {
    const env = loadEnv();
    if (env.PAYMENT_PROVIDER !== "stripe") return;

    const domains = [...new Set(
      env.PAYMENT_METHOD_DOMAINS.split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    )];
    if (domains.length === 0) return;

    const organizations = await prisma.organization.findMany({
      where: { stripeConnectedAccountId: { not: null } },
      select: { stripeConnectedAccountId: true },
    });
    const connectedAccountIds = [...new Set(
      organizations
        .map((organization) => organization.stripeConnectedAccountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    )];

    try {
      const created = await registerConnectedAccountPaymentMethodDomains(
        env.STRIPE_SECRET_KEY!,
        connectedAccountIds.map((connectedAccountId) => ({
          connectedAccountId,
          domains,
        })),
      );
      this.logger.log("Connected-account payment method domains synchronized.", {
        connectedAccounts: connectedAccountIds.length,
        domains: domains.length,
        created,
      });
    } catch (error) {
      // Wallet registration must be visible operationally but must not take
      // card checkout or the entire API offline during a Stripe outage.
      this.logger.error(
        "Connected-account payment method domain synchronization failed.",
        String(error),
      );
    }
  }
}
