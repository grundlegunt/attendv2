import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";
import { PaymentProvider } from "@cinema/payments";
import { EmailProvider } from "@cinema/notifications";
import {
  CreateTicketCheckoutInput,
  TicketingError,
  TicketingService as TicketingDomainService,
  verifyTicketCredential,
} from "@cinema/ticketing";
import { AppError } from "../common/app-error";
import { PAYMENT_PROVIDER } from "../payments/payments.module";
import { EMAIL_PROVIDER } from "../notifications/notifications.module";
import { loadEnv } from "@cinema/config/env";
import { createHash } from "node:crypto";

@Injectable()
export class TicketingService {
  private readonly domain: TicketingDomainService;

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(EMAIL_PROVIDER) emailProvider: EmailProvider,
  ) {
    this.domain = new TicketingDomainService(
      prisma,
      provider,
      loadEnv().QR_CREDENTIAL_SECRET,
      emailProvider,
    );
  }

  checkoutConfig(showtimeId: string) {
    return prisma.showtime
      .findFirst({
        where: { id: showtimeId, onSale: true, startsAt: { gt: new Date() } },
        select: {
          id: true,
          priceTier: { select: { ticketPriceMinor: true } },
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
                    select: { id: true, name: true, priceAdjustmentMinor: true },
                    orderBy: { name: "asc" },
                  },
                  menuCategories: {
                    where: { active: true },
                    select: {
                      id: true,
                      name: true,
                      items: {
                        where: { active: true, is86d: false },
                        select: {
                          id: true,
                          name: true,
                          description: true,
                          imageUrl: true,
                          priceCents: true,
                          chargeCategory: true,
                          isVegan: true,
                          isGlutenFree: true,
                          modifierGroups: {
                            where: { active: true },
                            select: {
                              id: true,
                              name: true,
                              selectionType: true,
                              required: true,
                              minSelections: true,
                              maxSelections: true,
                              modifiers: {
                                where: { active: true },
                                select: {
                                  id: true,
                                  name: true,
                                  priceDeltaCents: true,
                                },
                                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                              },
                            },
                            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                          },
                        },
                        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      },
                    },
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  },
                },
              },
            },
          },
        },
      })
      .then((showtime) => {
        if (!showtime) throw AppError.notFound("Showtime is not available.");
        const env = loadEnv();
        return {
          showtimeId: showtime.id,
          locationId: showtime.auditorium.location.id,
          currency: showtime.auditorium.location.currency,
          baseTicketPriceCents: showtime.priceTier.ticketPriceMinor,
          ticketTypes: showtime.auditorium.location.ticketTypes,
          orderAhead: {
            available: showtime.auditorium.location.menuCategories.some(
              (category) => category.items.length > 0,
            ),
            categories: showtime.auditorium.location.menuCategories.filter(
              (category) => category.items.length > 0,
            ),
          },
          payment: {
            ready: Boolean(
              env.PAYMENT_PROVIDER === "stripe" &&
                env.STRIPE_PUBLISHABLE_KEY &&
                env.STRIPE_SECRET_KEY &&
                env.STRIPE_WEBHOOK_SECRET &&
                showtime.auditorium.location.organization
                  .stripeConnectedAccountId,
            ),
            publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
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

  resumeCheckout(input: { checkoutIdempotencyKey: string; holderKey: string }) {
    return this.wrap(() => this.domain.resumeCheckout(input));
  }

  finalizeOrder(orderId: string) {
    return this.wrap(() => this.domain.finalizeOrder(orderId));
  }

  finalizeGuestOrder(orderId: string, holderKey: string) {
    return this.wrap(() => this.domain.finalizeGuestOrder(orderId, holderKey));
  }

  resendGuestReceipt(orderId: string, holderKey: string) {
    return this.wrap(() => this.domain.resendGuestReceipt(orderId, holderKey));
  }

  async scanTicket(input: {
    credential: string;
    expectedShowtimeId: string;
    employeeId: string;
    locationId: string;
    deviceId?: string;
    entrance?: string;
  }) {
    const scannedAt = new Date();
    const credentialFingerprint = createHash("sha256").update(input.credential).digest("hex");
    const credential = verifyTicketCredential(input.credential, loadEnv().QR_CREDENTIAL_SECRET);
    if (!credential) {
      await prisma.ticketScan.create({
        data: {
          scannedByEmployeeId: input.employeeId,
          expectedShowtimeId: input.expectedShowtimeId,
          deviceId: input.deviceId,
          entrance: input.entrance,
          result: "INVALID",
          scannedAt,
          credentialFingerprint,
        },
      });
      return { result: "INVALID" as const, scannedAt: scannedAt.toISOString(), ticket: null };
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "tickets" WHERE "id" = ${credential.ticketId} FOR UPDATE`;
      const ticket = await tx.ticket.findFirst({
        where: {
          id: credential.ticketId,
          ticketOrder: { locationId: input.locationId },
        },
        include: {
          ticketType: true,
          showtimeSeat: {
            include: {
              seat: true,
              showtime: { include: { movie: true, auditorium: true } },
            },
          },
        },
      });

      if (!ticket) {
        await tx.ticketScan.create({
          data: {
            scannedByEmployeeId: input.employeeId,
            expectedShowtimeId: input.expectedShowtimeId,
            deviceId: input.deviceId,
            entrance: input.entrance,
            result: "INVALID",
            scannedAt,
            credentialFingerprint,
          },
        });
        return { result: "INVALID" as const, scannedAt: scannedAt.toISOString(), ticket: null };
      }

      const showtime = ticket.showtimeSeat.showtime;
      const result =
        ticket.status === "REFUNDED"
          ? "REFUNDED"
          : ticket.status === "CANCELED"
            ? "CANCELED"
            : ticket.status === "ADMITTED"
              ? "ALREADY_USED"
              : input.expectedShowtimeId && input.expectedShowtimeId !== showtime.id
                ? "WRONG_SHOWTIME"
                : "VALID";

      await tx.ticketScan.create({
        data: {
          ticketId: ticket.id,
          scannedByEmployeeId: input.employeeId,
          expectedShowtimeId: input.expectedShowtimeId,
          deviceId: input.deviceId,
          entrance: input.entrance,
          result,
          scannedAt,
          credentialFingerprint,
        },
      });
      if (result === "VALID") {
        await tx.ticket.update({ where: { id: ticket.id }, data: { status: "ADMITTED" } });
      }
      return {
        result,
        scannedAt: scannedAt.toISOString(),
        ticket: {
          id: ticket.id,
          movie: showtime.movie.title,
          auditorium: showtime.auditorium.name,
          showtimeId: showtime.id,
          startsAt: showtime.startsAt.toISOString(),
          seat: ticket.showtimeSeat.seat.label,
          ticketType: ticket.ticketType.name,
        },
      };
    });
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
