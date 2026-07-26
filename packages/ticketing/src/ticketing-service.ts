import { randomBytes } from "node:crypto";
import {
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RefundStatus,
  TicketOrderStatus,
} from "@cinema/database";
import {
  PaymentProvider,
  ProviderPaymentStatus,
  VerifiedProviderEvent,
} from "@cinema/payments";
import { TicketingError } from "./ticketing-error";

export interface CreateTicketCheckoutInput {
  holdTokens: string[];
  holderKey: string;
  ticketTypeId: string;
  email: string;
  name?: string;
  diningAuthorizationRequested: boolean;
  checkoutIdempotencyKey: string;
}

interface LockedHold {
  id: string;
  showtimeSeatId: string;
  holderKey: string;
  expiresAt: Date;
  releasedAt: Date | null;
}

function paymentAttemptStatus(status: ProviderPaymentStatus): PaymentAttemptStatus {
  switch (status) {
    case "REQUIRES_ACTION":
      return PaymentAttemptStatus.REQUIRES_ACTION;
    case "PROCESSING":
      return PaymentAttemptStatus.PROCESSING;
    case "SUCCEEDED":
      return PaymentAttemptStatus.SUCCEEDED;
    case "FAILED":
      return PaymentAttemptStatus.FAILED;
    case "CANCELED":
      return PaymentAttemptStatus.CANCELED;
    default:
      return PaymentAttemptStatus.CREATED;
  }
}

function paymentStatus(status: ProviderPaymentStatus): PaymentStatus {
  switch (status) {
    case "REQUIRES_PAYMENT_METHOD":
      return PaymentStatus.REQUIRES_PAYMENT_METHOD;
    case "REQUIRES_ACTION":
      return PaymentStatus.REQUIRES_ACTION;
    case "PROCESSING":
      return PaymentStatus.PROCESSING;
    case "SUCCEEDED":
      return PaymentStatus.SUCCEEDED;
    case "FAILED":
      return PaymentStatus.FAILED;
    case "CANCELED":
      return PaymentStatus.CANCELED;
  }
}

function publicOrderNumber() {
  return `AT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function qrSeed() {
  // Milestone 4 replaces this opaque issuance seed with a signed QR token.
  return randomBytes(32).toString("base64url");
}

export class TicketingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async createCheckout(input: CreateTicketCheckoutInput) {
    const holdTokens = [...new Set(input.holdTokens)].sort();
    if (!input.checkoutIdempotencyKey || input.checkoutIdempotencyKey.length < 16) {
      throw TicketingError.validation("A valid checkout idempotency key is required.");
    }
    if (!input.holderKey || input.holderKey.length < 16) {
      throw TicketingError.validation("A valid checkout session is required.");
    }
    if (!holdTokens.length || holdTokens.length > 10) {
      throw TicketingError.validation("Select between 1 and 10 held seats.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw TicketingError.validation("A valid receipt email is required.");
    }

    const existing = await this.prisma.ticketOrder.findUnique({
      where: { checkoutIdempotencyKey: input.checkoutIdempotencyKey },
      include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
    });
    if (existing) return this.presentCheckout(existing);

    const holds = await this.prisma.seatHold.findMany({
      where: { holdToken: { in: holdTokens } },
      include: {
        showtimeSeat: {
          include: {
            seat: true,
            showtime: {
              include: {
                priceTier: true,
                auditorium: { include: { location: { include: { organization: true } } } },
              },
            },
          },
        },
      },
    });
    const now = new Date();
    if (
      holds.length !== holdTokens.length ||
      holds.some(
        (hold) =>
          hold.holderKey !== input.holderKey ||
          hold.releasedAt ||
          hold.expiresAt <= now,
      )
    ) {
      throw TicketingError.conflict("One or more seat holds have expired.", "HOLD_EXPIRED");
    }

    const showtimeIds = new Set(holds.map((hold) => hold.showtimeSeat.showtimeId));
    if (showtimeIds.size !== 1) {
      throw TicketingError.validation("All seats in one checkout must be for the same showtime.");
    }
    const first = holds[0]!;
    const showtime = first.showtimeSeat.showtime;
    const location = showtime.auditorium.location;
    if (showtime.startsAt <= now || !showtime.onSale) {
      throw TicketingError.conflict("This showtime is no longer on sale.");
    }
    const ticketType = await this.prisma.ticketType.findFirst({
      where: { id: input.ticketTypeId, locationId: location.id, active: true },
    });
    if (!ticketType) throw TicketingError.notFound("Ticket type not found.");

    const subtotalCents = showtime.priceTier.ticketPriceMinor * holds.length;
    const feesCents = showtime.priceTier.feeMinor * holds.length;
    const taxCents = Math.round(
      (subtotalCents * location.ticketTaxRateBasisPoints) / 10_000,
    );
    const totalCents = subtotalCents + feesCents + taxCents;

    let order;
    try {
      order = await this.prisma.ticketOrder.create({
        data: {
          locationId: location.id,
          ticketTypeId: ticketType.id,
          holdTokens,
          holderKey: input.holderKey,
          guestEmail: input.email.toLowerCase(),
          guestName: input.name?.trim() || null,
          diningAuthorizationRequested: input.diningAuthorizationRequested,
          status: TicketOrderStatus.AWAITING_PAYMENT,
          orderNumber: publicOrderNumber(),
          checkoutIdempotencyKey: input.checkoutIdempotencyKey,
          subtotalCents,
          feesCents,
          taxCents,
          totalCents,
          currency: showtime.priceTier.currency,
          payment: {
            create: {
              purpose: "TICKET_ORDER",
              amountCents: totalCents,
              currency: showtime.priceTier.currency,
              status: PaymentStatus.CREATED,
              idempotencyKey: `ticket-order:${input.checkoutIdempotencyKey}`,
              provider: this.paymentProvider.name,
            },
          },
        },
        include: { payment: { include: { attempts: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrent = await this.prisma.ticketOrder.findUnique({
          where: { checkoutIdempotencyKey: input.checkoutIdempotencyKey },
          include: { payment: { include: { attempts: true } } },
        });
        if (concurrent) return this.presentCheckout(concurrent);
      }
      throw error;
    }

    const intent = await this.paymentProvider.createPaymentIntent({
      connectedAccountId: location.organization.stripeConnectedAccountId ?? undefined,
      amountCents: totalCents,
      currency: showtime.priceTier.currency,
      metadata: {
        ticketOrderId: order.id,
        organizationId: location.organizationId,
        locationId: location.id,
      },
      idempotencyKey: order.payment!.idempotencyKey,
    });

    const updated = await this.prisma.ticketOrder.update({
      where: { id: order.id },
      data: {
        payment: {
          update: {
            providerPaymentId: intent.id,
            status: paymentStatus(intent.status),
            attempts: {
              create: {
                provider: this.paymentProvider.name,
                providerIntentId: intent.id,
                attemptNumber: 1,
                status: paymentAttemptStatus(intent.status),
              },
            },
          },
        },
      },
      include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
    });
    return this.presentCheckout(updated, intent.clientSecret);
  }

  async finalizeOrder(orderId: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        location: { include: { organization: true } },
        tickets: { include: { showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } } } },
      },
    });
    if (!order?.payment?.providerPaymentId) {
      throw TicketingError.notFound("Ticket order was not found.");
    }
    if (order.status === TicketOrderStatus.PAID) return this.presentConfirmation(order);

    const providerResult = await this.paymentProvider.retrievePaymentIntent({
      connectedAccountId: order.location.organization.stripeConnectedAccountId ?? undefined,
      paymentIntentId: order.payment.providerPaymentId,
    });
    if (providerResult.status !== "SUCCEEDED") {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: order.payment.id },
          data: { status: paymentStatus(providerResult.status) },
        }),
        this.prisma.paymentAttempt.updateMany({
          where: { paymentId: order.payment.id, providerIntentId: providerResult.id },
          data: {
            status: paymentAttemptStatus(providerResult.status),
            failureCode: providerResult.failureCode,
            failureMessage: providerResult.failureMessage,
          },
        }),
        this.prisma.ticketOrder.update({
          where: { id: order.id },
          data: {
            status:
              providerResult.status === "FAILED"
                ? TicketOrderStatus.PAYMENT_FAILED
                : TicketOrderStatus.AWAITING_PAYMENT,
          },
        }),
      ]);
      throw TicketingError.paymentRequired(
        providerResult.failureMessage ?? "Payment has not completed.",
      );
    }

    try {
      const finalized = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${order.id} FOR UPDATE`,
          );
          const lockedOrder = await tx.ticketOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: {
              payment: true,
              tickets: {
                include: {
                  showtimeSeat: {
                    include: { seat: true, showtime: { include: { movie: true, auditorium: true } } },
                  },
                },
              },
            },
          });
          if (lockedOrder.status === TicketOrderStatus.PAID) return lockedOrder;

          const lockedHolds = await tx.$queryRaw<LockedHold[]>(
            Prisma.sql`
              SELECT sh."id", sh."showtimeSeatId", sh."holderKey", sh."expiresAt", sh."releasedAt"
              FROM "seat_holds" sh
              JOIN "showtime_seats" ss ON ss."id" = sh."showtimeSeatId"
              WHERE sh."holdToken" IN (${Prisma.join(lockedOrder.holdTokens)})
              ORDER BY ss."id"
              FOR UPDATE OF ss, sh
            `,
          );
          const purchaseTime = new Date();
          if (
            lockedHolds.length !== lockedOrder.holdTokens.length ||
            lockedHolds.some(
              (hold) =>
                hold.holderKey !== lockedOrder.holderKey ||
                hold.releasedAt ||
                hold.expiresAt <= purchaseTime,
            )
          ) {
            throw TicketingError.conflict(
              "The seat hold expired before payment could be finalized.",
              "HOLD_EXPIRED_AFTER_PAYMENT",
            );
          }

          const inventoryIds = lockedHolds.map((hold) => hold.showtimeSeatId);
          const liveTicket = await tx.ticket.findFirst({
            where: {
              showtimeSeatId: { in: inventoryIds },
              status: { notIn: ["REFUNDED", "CANCELED"] },
            },
          });
          if (liveTicket) {
            throw TicketingError.conflict(
              "A selected seat is no longer available.",
              "SEAT_UNAVAILABLE_AFTER_PAYMENT",
            );
          }
          const perTicketPrice = Math.floor(
            lockedOrder.subtotalCents / lockedHolds.length,
          );
          await tx.ticket.createMany({
            data: lockedHolds.map((hold) => ({
              ticketOrderId: lockedOrder.id,
              showtimeSeatId: hold.showtimeSeatId,
              ticketTypeId: lockedOrder.ticketTypeId,
              priceCentsPaid: perTicketPrice,
              qrToken: qrSeed(),
            })),
          });
          await tx.seatHold.updateMany({
            where: { id: { in: lockedHolds.map((hold) => hold.id) }, releasedAt: null },
            data: { releasedAt: purchaseTime },
          });
          await tx.payment.update({
            where: { id: lockedOrder.payment!.id },
            data: { status: PaymentStatus.SUCCEEDED },
          });
          await tx.paymentAttempt.updateMany({
            where: {
              paymentId: lockedOrder.payment!.id,
              providerIntentId: providerResult.id,
            },
            data: { status: PaymentAttemptStatus.SUCCEEDED },
          });
          return tx.ticketOrder.update({
            where: { id: lockedOrder.id },
            data: { status: TicketOrderStatus.PAID },
            include: {
              payment: true,
              tickets: {
                include: {
                  showtimeSeat: {
                    include: { seat: true, showtime: { include: { movie: true, auditorium: true } } },
                  },
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      return this.presentConfirmation(finalized);
    } catch (error) {
      if (
        error instanceof TicketingError &&
        ["HOLD_EXPIRED_AFTER_PAYMENT", "SEAT_UNAVAILABLE_AFTER_PAYMENT"].includes(error.code)
      ) {
        await this.refundUnavailableOrder(order.id, error.code);
      }
      throw error;
    }
  }

  async processVerifiedWebhook(event: VerifiedProviderEvent) {
    const duplicate = await this.prisma.processedWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: this.paymentProvider.name,
          providerEventId: event.id,
        },
      },
    });
    if (duplicate) return { duplicate: true };
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: this.paymentProvider.name,
        providerPaymentId: event.paymentIntentId,
      },
    });
    if (!payment?.ticketOrderId) throw TicketingError.notFound("Payment was not found.");
    if (event.type === "payment_intent.succeeded") {
      await this.finalizeOrder(payment.ticketOrderId);
    } else {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status:
              event.type === "payment_intent.payment_failed"
                ? PaymentStatus.FAILED
                : PaymentStatus.REQUIRES_ACTION,
          },
        }),
        this.prisma.ticketOrder.update({
          where: { id: payment.ticketOrderId },
          data: {
            status:
              event.type === "payment_intent.payment_failed"
                ? TicketOrderStatus.PAYMENT_FAILED
                : TicketOrderStatus.AWAITING_PAYMENT,
          },
        }),
      ]);
    }
    try {
      await this.prisma.processedWebhookEvent.create({
        data: {
          provider: this.paymentProvider.name,
          providerEventId: event.id,
        },
      });
      return { duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { duplicate: true };
      }
      throw error;
    }
  }

  verifyAndProcessWebhook(rawBody: Buffer, signatureHeader: string) {
    const event = this.paymentProvider.verifyWebhookSignature({
      rawBody,
      signatureHeader,
    });
    return this.processVerifiedWebhook(event);
  }

  private async refundUnavailableOrder(orderId: string, reason: string) {
    const recovery = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${orderId} FOR UPDATE`,
      );
      const locked = await tx.ticketOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { payment: true, location: { include: { organization: true } } },
      });
      if (!locked.payment?.providerPaymentId) {
        throw TicketingError.notFound("Payment was not found for recovery.");
      }
      const idempotencyKey = `seat-unavailable-refund:${locked.payment.id}`;
      const refund = await tx.refund.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          paymentId: locked.payment.id,
          amountCents: locked.payment.amountCents,
          reason,
          idempotencyKey,
        },
      });
      await tx.ticketOrder.update({
        where: { id: locked.id },
        data: { status: TicketOrderStatus.EXPIRED },
      });
      await tx.payment.update({
        where: { id: locked.payment.id },
        data: { status: PaymentStatus.SUCCEEDED },
      });
      return { locked, refund };
    });

    if (recovery.refund.status === RefundStatus.SUCCEEDED) return;
    const result = await this.paymentProvider.refund({
      connectedAccountId:
        recovery.locked.location.organization.stripeConnectedAccountId ?? undefined,
      providerPaymentId: recovery.locked.payment!.providerPaymentId!,
      amountCents: recovery.refund.amountCents,
      reason,
      idempotencyKey: recovery.refund.idempotencyKey,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: recovery.refund.id },
        data: {
          status:
            result.status === "SUCCEEDED" ? RefundStatus.SUCCEEDED : RefundStatus.FAILED,
          providerRefundId: result.id,
        },
      });
      if (result.status === "SUCCEEDED") {
        await tx.payment.update({
          where: { id: recovery.locked.payment!.id },
          data: { status: PaymentStatus.REFUNDED },
        });
      } else {
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "payment.refund_attention_required",
            entityType: "Refund",
            entityId: recovery.refund.id,
            locationId: recovery.locked.locationId,
            afterState: {
              reason,
              paymentId: recovery.locked.payment!.id,
              failureMessage: result.failureMessage ?? "Provider refund failed.",
            },
          },
        });
      }
    });
  }

  private presentCheckout(
    order: {
      id: string;
      orderNumber: string;
      status: TicketOrderStatus;
      subtotalCents: number;
      feesCents: number;
      taxCents: number;
      totalCents: number;
      currency: string;
      payment: {
        id: string;
        providerPaymentId: string | null;
        status: PaymentStatus;
        attempts: Array<{ attemptNumber: number; status: PaymentAttemptStatus }>;
      } | null;
    },
    clientSecret?: string,
  ) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotalCents: order.subtotalCents,
      feesCents: order.feesCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      payment: order.payment
        ? {
            id: order.payment.id,
            providerPaymentId: order.payment.providerPaymentId,
            status: order.payment.status,
            clientSecret,
            attemptNumber: order.payment.attempts[0]?.attemptNumber ?? 0,
          }
        : null,
    };
  }

  private presentConfirmation(order: {
    id: string;
    orderNumber: string;
    status: TicketOrderStatus;
    totalCents: number;
    currency: string;
    tickets: Array<{
      id: string;
      qrToken: string;
      showtimeSeat: {
        seat: { label: string };
        showtime: {
          startsAt: Date;
          movie: { title: string };
          auditorium: { name: string };
        };
      };
    }>;
  }) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
      tickets: order.tickets.map((ticket) => ({
        id: ticket.id,
        issuanceToken: ticket.qrToken,
        seat: ticket.showtimeSeat.seat.label,
        movie: ticket.showtimeSeat.showtime.movie.title,
        auditorium: ticket.showtimeSeat.showtime.auditorium.name,
        startsAt: ticket.showtimeSeat.showtime.startsAt.toISOString(),
      })),
    };
  }
}
