import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import { PaymentProvider } from "@cinema/payments";
import {
  CreateTicketCheckoutInput,
  TicketingError,
  TicketingService as TicketingDomainService,
} from "@cinema/ticketing";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";

@Injectable()
export class TicketingService {
  private readonly domain: TicketingDomainService;

  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider) {
    this.domain = new TicketingDomainService(prisma, provider);
  }

  checkoutConfig(showtimeId: string) {
    return prisma.showtime
      .findFirst({
        where: { id: showtimeId, onSale: true, startsAt: { gt: new Date() } },
        select: {
          id: true,
          auditorium: {
            select: {
              location: {
                select: {
                  id: true,
                  currency: true,
                  organization: {
                    select: { stripeConnectedAccountId: true },
                  },
                  ticketTypes: {
                    where: { active: true },
                    select: { id: true, name: true },
                    orderBy: { name: "asc" },
                  },
                },
              },
            },
          },
        },
      })
      .then((showtime) => {
        if (!showtime) throw AppError.notFound("Showtime is not available.");
        return {
          showtimeId: showtime.id,
          locationId: showtime.auditorium.location.id,
          currency: showtime.auditorium.location.currency,
          ticketTypes: showtime.auditorium.location.ticketTypes,
          payment: {
            ready: Boolean(
              process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
                process.env.STRIPE_SECRET_KEY &&
                process.env.STRIPE_WEBHOOK_SECRET &&
                showtime.auditorium.location.organization
                  .stripeConnectedAccountId,
            ),
            publishableKey:
              process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
            connectedAccountId:
              showtime.auditorium.location.organization
                .stripeConnectedAccountId,
          },
        };
      });
  }

  createCheckout(input: CreateTicketCheckoutInput) {
    return this.wrap(() => this.domain.createCheckout(input));
  }

  finalizeOrder(orderId: string) {
    return this.wrap(() => this.domain.finalizeOrder(orderId));
  }

  processWebhook(rawBody: Buffer, signatureHeader: string) {
    let event;
    try {
      event = this.provider.verifyWebhookSignature({ rawBody, signatureHeader });
    } catch {
      throw AppError.forbidden("Webhook signature is invalid.");
    }
    return this.wrap(() => this.domain.processVerifiedWebhook(event));
  }

  /**
   * Durable safety net for refunds stuck in CREATED/PROCESSING (owning
   * process died mid-call, or the provider responded but the write never
   * committed) -- see TicketingService.reconcilePendingRefunds in
   * @cinema/ticketing. Invoked periodically by RefundReconciliationService.
   */
  reconcilePendingRefunds(options?: { leaseDurationMs?: number; now?: Date }) {
    return this.domain.reconcilePendingRefunds(options);
  }

  private async wrap<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof TicketingError)) throw error;
      if (error.status === 400) throw AppError.validationFailed(error.message);
      if (error.status === 404) throw AppError.notFound(error.message);
      if (error.status === 402) throw AppError.paymentRequired(error.message);
      throw AppError.conflict(error.message, { reason: error.code });
    }
  }
}
