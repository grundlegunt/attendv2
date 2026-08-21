import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RestaurantOrderItemStatus,
  RestaurantOrderSource,
  RestaurantOrderStatus,
  RestaurantTabStatus,
  RestaurantTabType,
  RefundStatus,
  TicketOrderStatus,
} from "@cinema/database";
import {
  PaymentProvider,
  ProviderDefinitiveError,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  VerifiedProviderEvent,
} from "@cinema/payments";
import { EmailProvider, TicketReceipt } from "@cinema/notifications";
import { TicketingError } from "./ticketing-error";
import { createTicketCredential } from "./qr-credential";
import {
  OrderAheadQuote,
  OrderAheadQuoteError,
  OrderAheadSelection,
  quoteOrderAheadSelections,
} from "./order-ahead-quote";

export interface CreateTicketCheckoutInput {
  holdTokens: string[];
  holderKey: string;
  ticketTypeId: string;
  ticketTypeSelections?: Array<{ holdToken: string; ticketTypeId: string }>;
  email: string;
  name?: string;
  zipCode?: string;
  promotionCode?: string;
  giftCardCode?: string;
  diningAuthorizationRequested: boolean;
  checkoutIdempotencyKey: string;
  orderAhead?: OrderAheadSelection[];
}

interface LockedHold {
  id: string;
  holdToken: string;
  showtimeSeatId: string;
  holderKey: string;
  expiresAt: Date;
  releasedAt: Date | null;
}

// Round 2 review fixes: how long a refund claim/reconciliation lease is
// held -- see Refund.leaseExpiresAt (schema.prisma) and
// reconcilePendingRefunds below.
const REFUND_LEASE_MS = 60_000;
const DINING_CONSENT_TERMS_VERSION = "dining-auto-settlement-2026-07-29";

type PersistedOrderAheadLine = OrderAheadQuote["lines"][number];
type TicketTypeSelection = { holdToken: string; ticketTypeId: string; priceCents?: number };

function normalizeTicketTypeSelections(
  holdTokens: string[],
  defaultTicketTypeId: string,
  selections?: TicketTypeSelection[],
) {
  const requested: TicketTypeSelection[] = selections?.length
    ? selections
    : holdTokens.map((holdToken) => ({ holdToken, ticketTypeId: defaultTicketTypeId }));
  const byHoldToken = new Map(requested.map((selection) => [selection.holdToken, selection]));
  if (requested.length !== holdTokens.length || byHoldToken.size !== holdTokens.length || holdTokens.some((token) => !byHoldToken.has(token))) {
    throw TicketingError.validation("Choose one ticket type for every held seat.");
  }
  return holdTokens.map((holdToken) => byHoldToken.get(holdToken)!);
}

function persistedTicketTypeSelections(value: Prisma.JsonValue | null): TicketTypeSelection[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as TicketTypeSelection[];
}

function normalizeOrderAheadSelections(selections: OrderAheadSelection[] = []) {
  return selections
    .map((selection) => ({
      menuItemId: selection.menuItemId,
      quantity: selection.quantity,
      modifierIds: [...selection.modifierIds].sort(),
    }))
    .sort((left, right) => left.menuItemId.localeCompare(right.menuItemId));
}

function persistedOrderAheadLines(value: Prisma.JsonValue | null): PersistedOrderAheadLine[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as PersistedOrderAheadLine[];
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

// Round 2 review fixes: the provider already normalizes a processor's raw
// refund status into this friendly three-value type (see
// StripePaymentProvider's own mapRefundStatus) -- this maps it onto the
// LOCAL RefundStatus enum, which has no separate "pending" value of its
// own. PROCESSING is the correct home for it: it already means "the
// processor accepted the request but the operation isn't confirmed
// settled yet," which is exactly what a provider-reported PENDING means.
function refundStatusFromProvider(status: ProviderRefundStatus): RefundStatus {
  if (status === "SUCCEEDED") return RefundStatus.SUCCEEDED;
  if (status === "FAILED") return RefundStatus.FAILED;
  return RefundStatus.PROCESSING;
}

function publicOrderNumber() {
  return `AT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export class TicketingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly paymentProvider: PaymentProvider,
    private readonly qrCredentialSecret: string,
    private readonly emailProvider: EmailProvider,
  ) {}

  async createCheckout(input: CreateTicketCheckoutInput) {
    const holdTokens = [...new Set(input.holdTokens)].sort();
    const ticketTypeSelections = normalizeTicketTypeSelections(holdTokens, input.ticketTypeId, input.ticketTypeSelections);
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
    // Round 2 review fixes: this used to just re-present `existing`
    // as-is, with NO clientSecret at all -- fine if a real PaymentIntent
    // was already attached, but if the process crashed between creating
    // this order and ever calling the provider (or between calling it
    // and persisting providerPaymentId), the retrying customer's browser
    // got back an order with nothing to actually confirm payment with.
    // completeCheckout finishes that work using this SAME order (never a
    // new one) instead of leaving it stuck.
    if (existing) {
      this.assertCheckoutReplayMatches(existing, input, holdTokens);
      return this.completeCheckout(existing);
    }

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
    const ticketTypes = await this.prisma.ticketType.findMany({
      where: { id: { in: [...new Set(ticketTypeSelections.map((selection) => selection.ticketTypeId))] }, locationId: location.id, active: true },
    });
    if (ticketTypes.length !== new Set(ticketTypeSelections.map((selection) => selection.ticketTypeId)).size) {
      throw TicketingError.notFound("One or more ticket types were not found.");
    }
    const ticketType = ticketTypes.find((candidate) => candidate.id === input.ticketTypeId) ?? ticketTypes[0]!;

    let orderAheadQuote: OrderAheadQuote = {
      lines: [],
      subtotalCents: 0,
      taxCents: 0,
      serviceChargeCents: 0,
      totalCents: 0,
    };
    if (input.orderAhead?.length) {
      const [menuItems, taxRules, serviceChargeRules] = await Promise.all([
        this.prisma.menuItem.findMany({
          where: {
            id: { in: input.orderAhead.map((selection) => selection.menuItemId) },
            active: true,
            is86d: false,
            menuCategory: { locationId: location.id, active: true },
            kitchenStation: { locationId: location.id, active: true },
          },
          include: {
            modifierGroups: {
              where: { active: true },
              include: { modifiers: { where: { active: true } } },
            },
          },
        }),
        this.prisma.taxRule.findMany({ where: { locationId: location.id, active: true } }),
        this.prisma.serviceChargeRule.findMany({
          where: { locationId: location.id, active: true, autoApply: true },
        }),
      ]);
      try {
        orderAheadQuote = quoteOrderAheadSelections({
          selections: normalizeOrderAheadSelections(input.orderAhead),
          catalog: menuItems,
          taxRules,
          serviceChargeRules,
        });
      } catch (error) {
        if (error instanceof OrderAheadQuoteError) throw TicketingError.validation(error.message);
        throw error;
      }
    }

    const quotedTicketTypeSelections = ticketTypeSelections.map((selection) => ({
      ...selection,
      priceCents: Math.max(0, showtime.priceTier.ticketPriceMinor + ticketTypes.find((type) => type.id === selection.ticketTypeId)!.priceAdjustmentMinor),
    }));
    const subtotalCents = quotedTicketTypeSelections.reduce((sum, selection) => sum + selection.priceCents, 0);
    const feesCents = showtime.priceTier.feeMinor * holds.length;
    const promotion = input.promotionCode
      ? await this.prisma.promotion.findFirst({
          where: {
            locationId: location.id,
            code: input.promotionCode.toUpperCase(),
            active: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            ],
          },
          include: { ticketOrders: { where: { status: { in: ["PAID", "EXCHANGED"] } }, select: { id: true } } },
        })
      : null;
    if (input.promotionCode && !promotion) throw TicketingError.notFound("Promotion was not found or is inactive.");
    if (promotion?.minimumSubtotalCents != null && subtotalCents < promotion.minimumSubtotalCents) {
      throw TicketingError.validation(`Promotion requires a minimum ticket subtotal of ${promotion.minimumSubtotalCents} cents.`);
    }
    if (promotion?.maximumRedemptions != null && promotion.ticketOrders.length >= promotion.maximumRedemptions) {
      throw TicketingError.conflict("Promotion redemption limit has been reached.");
    }
    const discountCents = !promotion
      ? 0
      : promotion.type === "COMP"
        ? subtotalCents
        : promotion.type === "FIXED_AMOUNT"
          ? Math.min(subtotalCents, promotion.amountCents ?? 0)
          : Math.min(subtotalCents, Math.round(subtotalCents * (promotion.percentageBasisPoints ?? 0) / 10_000));
    const taxableSubtotal = subtotalCents - discountCents;
    const taxCents = Math.round(
      (taxableSubtotal * location.ticketTaxRateBasisPoints) / 10_000,
    );
    const totalCents = taxableSubtotal + feesCents + taxCents + orderAheadQuote.totalCents;
    let giftCard: { id: string; balanceCents: number; currency: string } | null = null;
    let giftCardCents = 0;
    if (input.giftCardCode) {
      const codeHash = createHash("sha256").update(input.giftCardCode.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
      giftCard = await this.prisma.giftCard.findFirst({ where: { organizationId: location.organizationId, codeHash, status: "ACTIVE" }, select: { id: true, balanceCents: true, currency: true } });
      if (!giftCard) throw TicketingError.notFound("Gift card was not found or is inactive.");
      if (giftCard.currency !== showtime.priceTier.currency) throw TicketingError.validation("Gift card currency does not match this order.");
      giftCardCents = Math.min(giftCard.balanceCents, totalCents);
      if (giftCardCents <= 0) throw TicketingError.validation("Gift card balance is insufficient.");
    }
    const normalizedEmail = input.email.toLowerCase();
    let customer;
    try {
      customer = await this.prisma.customer.upsert({
        where: { email: normalizedEmail },
        create: {
          email: normalizedEmail,
          name: input.name?.trim() || null,
          isGuest: true,
        },
        update: input.name?.trim() ? { name: input.name.trim() } : {},
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // Two first-time checkouts for the same email can both choose the
      // create side of Prisma's upsert. PostgreSQL rejects the loser before
      // the winner is necessarily visible on this connection, so briefly
      // wait for that committed customer instead of returning a 500.
      customer = null;
      for (let attempt = 0; attempt < 5 && !customer; attempt += 1) {
        customer = await this.prisma.customer.findUnique({ where: { email: normalizedEmail } });
        if (!customer) await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
      if (!customer) throw error;
    }

    let order;
    try {
      order = await this.prisma.ticketOrder.create({
        data: {
          locationId: location.id,
          customerId: customer.id,
          ticketTypeId: ticketType.id,
          ticketTypeSelections: quotedTicketTypeSelections as unknown as Prisma.InputJsonValue,
          holdTokens,
          holderKey: input.holderKey,
          guestEmail: normalizedEmail,
          guestName: input.name?.trim() || null,
          zipCode: input.zipCode?.trim() || null,
          diningAuthorizationRequested: input.diningAuthorizationRequested,
          status: TicketOrderStatus.AWAITING_PAYMENT,
          orderNumber: publicOrderNumber(),
          checkoutIdempotencyKey: input.checkoutIdempotencyKey,
          subtotalCents,
          discountCents,
          feesCents,
          taxCents,
          orderAheadItems: orderAheadQuote.lines as unknown as Prisma.InputJsonValue,
          orderAheadSubtotalCents: orderAheadQuote.subtotalCents,
          orderAheadTaxCents: orderAheadQuote.taxCents,
          orderAheadServiceChargeCents: orderAheadQuote.serviceChargeCents,
          totalCents,
          currency: showtime.priceTier.currency,
          promotionId: promotion?.id,
          giftCardId: giftCard?.id,
          giftCardCents,
          ...(totalCents - giftCardCents > 0 ? { payment: {
            create: {
              purpose: "TICKET_ORDER",
              amountCents: totalCents - giftCardCents,
              currency: showtime.priceTier.currency,
              status: PaymentStatus.CREATED,
              idempotencyKey: `ticket-order:${input.checkoutIdempotencyKey}`,
              provider: this.paymentProvider.name,
            },
          } } : {}),
        },
        include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // PostgreSQL can report the unique-key conflict before the winning
        // transaction's row is visible to this connection. Give that commit
        // a brief bounded window to become readable instead of turning a
        // valid concurrent replay into a 500 response.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const concurrent = await this.prisma.ticketOrder.findUnique({
            where: { checkoutIdempotencyKey: input.checkoutIdempotencyKey },
            include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
          });
          if (concurrent) {
            this.assertCheckoutReplayMatches(concurrent, input, holdTokens);
            return this.completeCheckout(concurrent);
          }
          await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
      }
      throw error;
    }

    return this.completeCheckout(order);
  }

  async resumeCheckout(input: { checkoutIdempotencyKey: string; holderKey: string }) {
    if (!input.checkoutIdempotencyKey || input.checkoutIdempotencyKey.length < 16) {
      throw TicketingError.validation("A valid checkout idempotency key is required.");
    }
    if (!input.holderKey || input.holderKey.length < 16) {
      throw TicketingError.validation("A valid checkout session is required.");
    }
    const order = await this.prisma.ticketOrder.findUnique({
      where: { checkoutIdempotencyKey: input.checkoutIdempotencyKey },
      include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
    });
    if (!order || order.holderKey !== input.holderKey) {
      throw TicketingError.notFound("Checkout was not found.");
    }
    return this.completeCheckout(order);
  }

  private assertCheckoutReplayMatches(
    order: {
      ticketTypeId: string;
      holdTokens: string[];
      holderKey: string;
      guestEmail: string | null;
      guestName: string | null;
      zipCode: string | null;
      diningAuthorizationRequested: boolean | null;
      orderAheadItems: Prisma.JsonValue | null;
      ticketTypeSelections: Prisma.JsonValue | null;
    },
    input: CreateTicketCheckoutInput,
    holdTokens: string[],
  ) {
    const persistedSelections = normalizeOrderAheadSelections(
      persistedOrderAheadLines(order.orderAheadItems).map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        modifierIds: line.modifiers.map((modifier) => modifier.id),
      })),
    );
    const requestedSelections = normalizeOrderAheadSelections(input.orderAhead);
    const requestedTicketTypes = normalizeTicketTypeSelections(holdTokens, input.ticketTypeId, input.ticketTypeSelections);
    const persistedTicketTypes = persistedTicketTypeSelections(order.ticketTypeSelections)
      .map(({ holdToken, ticketTypeId }) => ({ holdToken, ticketTypeId }));
    const matches = order.ticketTypeId === input.ticketTypeId
      && order.holderKey === input.holderKey
      && order.holdTokens.length === holdTokens.length
      && order.holdTokens.every((token, index) => token === holdTokens[index])
      && order.guestEmail === input.email.toLowerCase()
      && order.guestName === (input.name?.trim() || null)
      && order.zipCode === (input.zipCode?.trim() || null)
      && order.diningAuthorizationRequested === input.diningAuthorizationRequested
      && JSON.stringify(persistedTicketTypes) === JSON.stringify(requestedTicketTypes)
      && JSON.stringify(persistedSelections) === JSON.stringify(requestedSelections);
    if (!matches) throw TicketingError.conflict("The checkout idempotency key was already used with different checkout details.");
  }

  /**
   * Round 2 review fixes: completes phase 2 (the provider PaymentIntent
   * call) and phase 3 (persisting providerPaymentId + the first
   * PaymentAttempt) for an order that already exists -- whether it's
   * brand new (just created above) or a crash-recovery replay found via
   * the checkout idempotency key. Reads back whatever was actually
   * persisted on `order` rather than trusting the original request again,
   * since a retry may be happening in a request that didn't even supply
   * the original input shape.
   */
  private async completeCheckout(order: {
    id: string;
    locationId: string;
    customerId: string | null;
    guestEmail: string | null;
    guestName: string | null;
    diningAuthorizationRequested: boolean | null;
    orderNumber: string;
    status: TicketOrderStatus;
    subtotalCents: number;
    discountCents: number;
    feesCents: number;
    taxCents: number;
    orderAheadSubtotalCents: number;
    orderAheadTaxCents: number;
    orderAheadServiceChargeCents: number;
    totalCents: number;
    giftCardCents: number;
    currency: string;
    promotionId: string | null;
    payment: {
      id: string;
      idempotencyKey: string;
      amountCents: number;
      providerPaymentId: string | null;
      status: PaymentStatus;
      attempts: Array<{ attemptNumber: number; status: PaymentAttemptStatus }>;
    } | null;
  }) {
    const location = await this.prisma.location.findFirstOrThrow({
      where: { id: order.locationId },
      include: { organization: true },
    });
    const connectedAccountId = location.organization.stripeConnectedAccountId ?? undefined;
    const promotion = order.promotionId
      ? await this.prisma.promotion.findUnique({ where: { id: order.promotionId }, select: { code: true, name: true } })
      : null;
    const paymentCustomer =
      order.diningAuthorizationRequested && order.customerId && order.guestEmail
        ? await this.ensurePaymentCustomer({
            organizationId: location.organizationId,
            customerId: order.customerId,
            connectedAccountId,
            email: order.guestEmail,
            name: order.guestName ?? undefined,
          })
        : null;

    if (order.payment?.providerPaymentId) {
      // A real PaymentIntent already exists for this order -- replay it
      // rather than creating a second one. Re-retrieved (not read from
      // our own cached fields) so a long-dormant retry still gets a
      // live, usable clientSecret.
      const intent = await this.paymentProvider.retrievePaymentIntent({
        connectedAccountId,
        paymentIntentId: order.payment.providerPaymentId,
      });
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: order.payment.id },
          data: { status: paymentStatus(intent.status) },
        }),
        this.prisma.paymentAttempt.updateMany({
          where: { paymentId: order.payment.id, providerIntentId: intent.id },
          data: {
            status: paymentAttemptStatus(intent.status),
            failureCode: intent.failureCode,
            failureMessage: intent.failureMessage,
          },
        }),
      ]);
      return this.presentCheckout(order, promotion, intent.clientSecret, intent.status);
    }

    if (!order.payment) {
      if (order.giftCardCents === order.totalCents) return this.presentCheckout(order, promotion);
      throw TicketingError.notFound("Ticket order has no payment record.");
    }

    const idempotencyKey = order.payment.idempotencyKey;
    const intent = await this.paymentProvider.createPaymentIntent({
      connectedAccountId,
      providerCustomerId: paymentCustomer?.providerCustomerId,
      savePaymentMethodForFuture: Boolean(order.diningAuthorizationRequested),
      amountCents: order.payment.amountCents,
      currency: order.currency,
      metadata: {
        ticketOrderId: order.id,
        organizationId: location.organizationId,
        locationId: location.id,
      },
      idempotencyKey,
    });

    try {
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
      return this.presentCheckout(updated, promotion, intent.clientSecret, intent.status);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // A concurrent call for the same order already recorded this
        // exact PaymentIntent (idempotencyKey collision) -- not an
        // error, the work is already done.
        const settled = await this.prisma.ticketOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: { payment: { include: { attempts: { orderBy: { attemptNumber: "desc" } } } } },
        });
        return this.presentCheckout(settled, promotion, intent.clientSecret, intent.status);
      }
      throw error;
    }
  }

  private async ensurePaymentCustomer(input: {
    organizationId: string;
    customerId: string;
    connectedAccountId?: string;
    email: string;
    name?: string;
  }) {
    const existing = await this.prisma.paymentCustomer.findUnique({
      where: {
        organizationId_customerId_provider: {
          organizationId: input.organizationId,
          customerId: input.customerId,
          provider: this.paymentProvider.name,
        },
      },
    });
    if (existing) return existing;

    const providerCustomer = await this.paymentProvider.createCustomer({
      connectedAccountId: input.connectedAccountId,
      email: input.email,
      name: input.name,
      metadata: {
        organizationId: input.organizationId,
        customerId: input.customerId,
      },
      idempotencyKey: `payment-customer:${input.organizationId}:${input.customerId}`,
    });
    return this.prisma.paymentCustomer.upsert({
      where: {
        organizationId_customerId_provider: {
          organizationId: input.organizationId,
          customerId: input.customerId,
          provider: this.paymentProvider.name,
        },
      },
      create: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        provider: this.paymentProvider.name,
        providerCustomerId: providerCustomer.id,
      },
      update: {},
    });
  }

  async finalizeOrder(orderId: string) {
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        location: { include: { organization: true } },
        tickets: { include: { ticketType: true, showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } } } },
      },
    });
    if (order && !order.payment && order.giftCardId && order.giftCardCents === order.totalCents) {
      return this.finalizeGiftCardOnlyOrder(order.id);
    }
    if (!order?.payment?.providerPaymentId) {
      throw TicketingError.notFound("Ticket order was not found.");
    }

    // Round 2 review fixes: there is deliberately NO "already PAID,
    // short-circuit" fast path here. A prior design gated one on
    // `order.status === PAID` alone -- but once a durable verification
    // flag (below) exists, a snapshot-based short-circuit like that can
    // itself become a race: one concurrent attempt can read "not
    // flagged" before a different attempt records a GENUINE mismatch,
    // and return success without ever re-checking. No snapshot-based
    // check can close that gap -- only re-running verification every
    // time does. This is safe unconditionally: exact duplicate webhook
    // deliveries are already deduplicated earlier (processedWebhookEvent,
    // in processVerifiedWebhook below), and every other repeated call
    // (the frontend racing the webhook, a redelivery, a customer
    // refreshing) is already made safe by the ticket-issuing
    // transaction's own row-lock + `lockedOrder.status === PAID` no-op
    // guard further down, unchanged by this fix. The accepted cost is a
    // real one -- an extra provider API call on every repeat call
    // instead of an instant return.
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

    // Round 2 review fixes: "the provider confirms this PaymentIntent
    // succeeded" is not, by itself, proof this is the RIGHT charge for
    // this order -- verify the actual payment facts before treating
    // "succeeded" as sufficient to issue tickets. This is most valuable
    // as a check against a bug in OUR OWN record-keeping (a corrupted/
    // mismatched Payment.providerPaymentId -- including from the webhook
    // reconstruction path in processVerifiedWebhook, which writes that
    // field from webhook-supplied data) rather than anything the
    // processor itself would get wrong, but the consequence of NOT
    // checking it -- silently issuing tickets against an unverified
    // charge -- is severe enough to check unconditionally.
    const mismatch =
      providerResult.amountCents !== order.payment.amountCents ||
      providerResult.currency.toLowerCase() !== order.payment.currency.toLowerCase() ||
      providerResult.metadata.ticketOrderId !== order.id;

    if (mismatch) {
      // Persisted, not just logged -- a customer could be charged while
      // this order never gets its tickets, and that must never be
      // traceable only through structured logs nobody may ever read.
      const note =
        `Expected amountCents=${order.payment.amountCents} currency=${order.payment.currency} ticketOrderId=${order.id}; ` +
        `got amountCents=${providerResult.amountCents} currency=${providerResult.currency} ` +
        `ticketOrderId=${providerResult.metadata.ticketOrderId ?? "(missing)"} from providerPaymentId=${providerResult.id}.`;
      await this.prisma.payment.update({
        where: { id: order.payment.id },
        data: { verificationFailedAt: new Date(), verificationFailureNote: note },
      });
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "payment.verification_mismatch.manual_review_required",
          orderId: order.id,
          paymentId: order.payment.id,
          providerPaymentId: providerResult.id,
          expectedAmountCents: order.payment.amountCents,
          expectedCurrency: order.payment.currency,
          actualAmountCents: providerResult.amountCents,
          actualCurrency: providerResult.currency,
          actualMetadataTicketOrderId: providerResult.metadata.ticketOrderId,
        }),
      );
      throw TicketingError.conflict(
        "Payment verification failed: the confirmed charge does not match this order's expected amount, " +
          "currency, or identity. This requires manual review before the order can be finalized.",
        "PAYMENT_VERIFICATION_FAILED",
      );
    }

    // Round 2 review fixes (equivalent to the reference implementation's
    // "Payment.status decoupled from ticket issuance" fix): mark the
    // confirmed charge SUCCEEDED immediately, independent of whether
    // ticket issuance below succeeds -- this must survive even if that
    // transaction rolls back for an unrelated reason (a transient DB
    // error, not just the seats-unavailable case already handled). Any
    // prior review flag is cleared UNCONDITIONALLY, in its OWN statement:
    // it cannot be folded into the status-guarded update, because that
    // update's WHERE deliberately excludes rows already at SUCCEEDED (to
    // avoid downgrading a refunded payment) -- if Payment.status is
    // ALREADY SUCCEEDED here (e.g. an earlier attempt got this far but
    // then failed for an unrelated reason before TicketOrder ever
    // reached PAID), that guarded update matches zero rows, and a
    // flag-clear folded into it would silently never run.
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: {
          id: order.payment.id,
          status: { notIn: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        data: { status: PaymentStatus.SUCCEEDED },
      }),
      this.prisma.payment.updateMany({
        where: { id: order.payment.id, verificationFailedAt: { not: null } },
        data: { verificationFailedAt: null, verificationFailureNote: null },
      }),
      this.prisma.paymentAttempt.updateMany({
        where: { paymentId: order.payment.id, providerIntentId: providerResult.id },
        data: { status: PaymentAttemptStatus.SUCCEEDED },
      }),
    ]);

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
                  ticketType: true,
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
              SELECT sh."id", sh."holdToken", sh."showtimeSeatId", sh."holderKey", sh."expiresAt", sh."releasedAt"
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
          if (lockedOrder.giftCardId && lockedOrder.giftCardCents > 0) {
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "gift_cards" WHERE "id" = ${lockedOrder.giftCardId} FOR UPDATE`);
            const giftCard = await tx.giftCard.findFirst({ where: { id: lockedOrder.giftCardId, organizationId: order.location.organizationId, status: "ACTIVE" } });
            if (!giftCard || giftCard.currency !== lockedOrder.currency || giftCard.balanceCents < lockedOrder.giftCardCents) {
              throw TicketingError.conflict("The gift card is no longer available for this order.", "GIFT_CARD_UNAVAILABLE_AFTER_PAYMENT");
            }
            const balanceAfterCents = giftCard.balanceCents - lockedOrder.giftCardCents;
            await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: balanceAfterCents } });
            await tx.giftCardTransaction.create({ data: { giftCardId: giftCard.id, locationId: lockedOrder.locationId, type: "REDEMPTION", amountCents: -lockedOrder.giftCardCents, balanceAfterCents, reference: lockedOrder.id } });
          }
          const perTicketPrice = Math.floor(
            lockedOrder.subtotalCents / lockedHolds.length,
          );
          const selectedTicketTypes = normalizeTicketTypeSelections(
            lockedOrder.holdTokens,
            lockedOrder.ticketTypeId,
            persistedTicketTypeSelections(lockedOrder.ticketTypeSelections),
          );
          const ticketTypeByHold = new Map(selectedTicketTypes.map((selection) => [selection.holdToken, selection.ticketTypeId]));
          await tx.ticket.createMany({
            data: lockedHolds.map((hold) => {
              const id = randomUUID();
              return {
                id,
                ticketOrderId: lockedOrder.id,
                showtimeSeatId: hold.showtimeSeatId,
                ticketTypeId: ticketTypeByHold.get(hold.holdToken)!,
                priceCentsPaid: selectedTicketTypes.find((selection) => selection.holdToken === hold.holdToken)?.priceCents ?? perTicketPrice,
                qrToken: createTicketCredential(id, this.qrCredentialSecret),
              };
            }),
          });
          await this.createPrepaidOrderAheadTab(tx, lockedOrder, inventoryIds);
          await tx.seatHold.updateMany({
            where: { id: { in: lockedHolds.map((hold) => hold.id) }, releasedAt: null },
            data: { releasedAt: purchaseTime },
          });
          return tx.ticketOrder.update({
            where: { id: lockedOrder.id },
            data: { status: TicketOrderStatus.PAID },
            include: {
              payment: true,
              tickets: {
                include: {
                  ticketType: true,
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
      const diningAuthorization = await this.persistDiningAuthorization(
        finalized,
        providerResult.paymentMethod,
      );
      const receiptDelivery = await this.deliverReceipt(finalized);
      return this.presentConfirmation(finalized, receiptDelivery, diningAuthorization);
    } catch (error) {
      if (
        error instanceof TicketingError &&
        ["HOLD_EXPIRED_AFTER_PAYMENT", "SEAT_UNAVAILABLE_AFTER_PAYMENT", "GIFT_CARD_UNAVAILABLE_AFTER_PAYMENT"].includes(error.code)
      ) {
        await this.refundUnavailableOrder(order.id, error.code);
      }
      throw error;
    }
  }

  async finalizeGuestOrder(orderId: string, holderKey: string) {
    if (!holderKey || holderKey.length < 16) {
      throw TicketingError.validation("A valid checkout session is required.");
    }
    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: orderId },
      select: { holderKey: true },
    });
    if (!order || order.holderKey !== holderKey) {
      throw TicketingError.notFound("Ticket order was not found.");
    }
    return this.finalizeOrder(orderId);
  }

  async resendGuestReceipt(orderId: string, holderKey: string) {
    const order = await this.prisma.ticketOrder.findFirst({
      where: {
        id: orderId,
        holderKey,
        status: { in: [TicketOrderStatus.PAID, TicketOrderStatus.EXCHANGED] },
        guestEmail: { not: null },
      },
      include: {
        tickets: {
          where: { status: { in: ["ISSUED", "ADMITTED"] } },
          include: {
            ticketType: true,
            showtimeSeat: {
              include: {
                seat: true,
                showtime: { include: { movie: true, auditorium: true } },
              },
            },
          },
        },
      },
    });
    if (!order || order.tickets.length === 0) {
      throw TicketingError.notFound("Ticket order was not found.");
    }
    const receiptDelivery = await this.deliverReceipt(order);
    return { receiptDelivery, email: order.guestEmail! };
  }

  private async finalizeGiftCardOnlyOrder(orderId: string) {
    const finalized = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${orderId} FOR UPDATE`);
      const order = await tx.ticketOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { payment: true, location: { include: { organization: true } }, tickets: { include: { ticketType: true, showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } } } } },
      });
      if (order.status === TicketOrderStatus.PAID) return order;
      if (order.payment || !order.giftCardId || order.giftCardCents !== order.totalCents) throw TicketingError.conflict("Gift-card-only order is invalid.");
      const holds = await tx.$queryRaw<LockedHold[]>(Prisma.sql`
        SELECT sh."id", sh."holdToken", sh."showtimeSeatId", sh."holderKey", sh."expiresAt", sh."releasedAt"
        FROM "seat_holds" sh JOIN "showtime_seats" ss ON ss."id" = sh."showtimeSeatId"
        WHERE sh."holdToken" IN (${Prisma.join(order.holdTokens)}) ORDER BY ss."id" FOR UPDATE OF ss, sh
      `);
      const now = new Date();
      if (holds.length !== order.holdTokens.length || holds.some((hold) => hold.holderKey !== order.holderKey || hold.releasedAt || hold.expiresAt <= now)) throw TicketingError.conflict("The seat hold expired before the gift card could be finalized.", "HOLD_EXPIRED");
      const inventoryIds = holds.map((hold) => hold.showtimeSeatId);
      if (await tx.ticket.findFirst({ where: { showtimeSeatId: { in: inventoryIds }, status: { notIn: ["REFUNDED", "CANCELED"] } } })) throw TicketingError.conflict("A selected seat is no longer available.", "SEAT_UNAVAILABLE");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "gift_cards" WHERE "id" = ${order.giftCardId} FOR UPDATE`);
      const giftCard = await tx.giftCard.findFirst({ where: { id: order.giftCardId, organizationId: order.location.organizationId, status: "ACTIVE" } });
      if (!giftCard || giftCard.currency !== order.currency || giftCard.balanceCents < order.giftCardCents) throw TicketingError.paymentRequired("The gift card is no longer available for this order.");
      const balanceAfterCents = giftCard.balanceCents - order.giftCardCents;
      await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: balanceAfterCents } });
      await tx.giftCardTransaction.create({ data: { giftCardId: giftCard.id, locationId: order.locationId, type: "REDEMPTION", amountCents: -order.giftCardCents, balanceAfterCents, reference: order.id } });
      const perTicketPrice = Math.floor(order.subtotalCents / holds.length);
      const selectedTicketTypes = normalizeTicketTypeSelections(order.holdTokens, order.ticketTypeId, persistedTicketTypeSelections(order.ticketTypeSelections));
      const ticketTypeByHold = new Map(selectedTicketTypes.map((selection) => [selection.holdToken, selection.ticketTypeId]));
      await tx.ticket.createMany({ data: holds.map((hold) => { const id = randomUUID(); return { id, ticketOrderId: order.id, showtimeSeatId: hold.showtimeSeatId, ticketTypeId: ticketTypeByHold.get(hold.holdToken)!, priceCentsPaid: selectedTicketTypes.find((selection) => selection.holdToken === hold.holdToken)?.priceCents ?? perTicketPrice, qrToken: createTicketCredential(id, this.qrCredentialSecret) }; }) });
      await this.createPrepaidOrderAheadTab(tx, order, inventoryIds);
      await tx.seatHold.updateMany({ where: { id: { in: holds.map((hold) => hold.id) }, releasedAt: null }, data: { releasedAt: now } });
      return tx.ticketOrder.update({ where: { id: order.id }, data: { status: TicketOrderStatus.PAID }, include: { payment: true, location: { include: { organization: true } }, tickets: { include: { ticketType: true, showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } } } } } });
    });
    const diningAuthorization = await this.persistDiningAuthorization(finalized, undefined);
    const receiptDelivery = await this.deliverReceipt(finalized);
    return this.presentConfirmation(finalized, receiptDelivery, diningAuthorization);
  }

  private async createPrepaidOrderAheadTab(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      locationId: string;
      customerId: string | null;
      orderNumber: string;
      orderAheadItems: Prisma.JsonValue | null;
      orderAheadSubtotalCents: number;
      orderAheadTaxCents: number;
      orderAheadServiceChargeCents: number;
    },
    showtimeSeatIds: string[],
  ) {
    const lines = persistedOrderAheadLines(order.orderAheadItems);
    if (!lines.length) return;

    const issuedTickets = await tx.ticket.findMany({
      where: { ticketOrderId: order.id, showtimeSeatId: { in: showtimeSeatIds } },
      include: {
        showtimeSeat: {
          include: {
            seat: true,
            showtime: { include: { auditorium: true } },
          },
        },
      },
    });
    if (issuedTickets.length !== showtimeSeatIds.length) {
      throw TicketingError.conflict(
        "The order-ahead basket could not be linked to every purchased seat.",
        "ORDER_AHEAD_SEAT_LINK_FAILED",
      );
    }
    const firstTicket = issuedTickets[0]!;
    const orderAheadTotalCents =
      order.orderAheadSubtotalCents +
      order.orderAheadTaxCents +
      order.orderAheadServiceChargeCents;
    const tab = await tx.restaurantTab.create({
      data: {
        locationId: order.locationId,
        primaryCustomerId: order.customerId,
        tabType: RestaurantTabType.SEAT_LINKED,
        showtimeId: firstTicket.showtimeSeat.showtimeId,
        status: RestaurantTabStatus.OPEN,
        subtotalCents: order.orderAheadSubtotalCents,
        taxCents: order.orderAheadTaxCents,
        serviceChargeCents: order.orderAheadServiceChargeCents,
        totalCents: orderAheadTotalCents,
        prepaidCents: orderAheadTotalCents,
      },
    });

    for (const ticket of issuedTickets) {
      const tabSeat = await tx.restaurantTabSeat.create({
        data: {
          restaurantTabId: tab.id,
          showtimeSeatId: ticket.showtimeSeatId,
          ticketId: ticket.id,
        },
      });
      await tx.showtimeSeat.update({
        where: { id: ticket.showtimeSeatId },
        data: { currentTabSeatId: tabSeat.id },
      });
    }

    const restaurantOrder = await tx.restaurantOrder.create({
      data: {
        restaurantTabId: tab.id,
        showtimeSeatId: firstTicket.showtimeSeatId,
        source: RestaurantOrderSource.ONLINE_ORDER_AHEAD,
        ticketOrderId: order.id,
        status: RestaurantOrderStatus.SENT,
        placedAt: new Date(),
      },
    });
    const items = [];
    for (const line of lines) {
      items.push(
        await tx.restaurantOrderItem.create({
          data: {
            restaurantOrderId: restaurantOrder.id,
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            unitPriceCentsSnapshot: line.basePriceCents,
            selectedModifiers: line.modifiers as unknown as Prisma.InputJsonValue,
            modifierTotalCents: line.unitPriceCents - line.basePriceCents,
            kitchenStationId: line.kitchenStationId,
            status: RestaurantOrderItemStatus.SENT,
          },
        }),
      );
    }
    const stationIds = [...new Set(items.map((item) => item.kitchenStationId))];
    for (const kitchenStationId of stationIds) {
      await tx.fulfillmentTicket.create({
        data: {
          restaurantOrderId: restaurantOrder.id,
          kitchenStationId,
          tabLabel: tab.label,
          auditoriumName: firstTicket.showtimeSeat.showtime.auditorium.name,
          seatLabels:
            firstTicket.showtimeSeat.showtime.auditorium.seatingMode ===
            "GENERAL_ADMISSION"
              ? ["General admission"]
              : issuedTickets
                  .map((ticket) => ticket.showtimeSeat.seat.label)
                  .sort(),
          showtimeId: firstTicket.showtimeSeat.showtimeId,
          showtimeStartsAt: firstTicket.showtimeSeat.showtime.startsAt,
          serverName: "Order ahead",
          items: {
            connect: items
              .filter((item) => item.kitchenStationId === kitchenStationId)
              .map((item) => ({ id: item.id })),
          },
        },
      });
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

    if (event.type === "refund.updated") {
      // Round 2 review fixes: async refund-status webhook -- a §5.1-style
      // refund that settles asynchronously (the provider reported PENDING
      // at creation; some payment methods don't confirm a refund
      // synchronously) needs to hear about the eventual outcome somehow.
      // This is the real-time half of that; reconcilePendingRefunds below
      // is the polling half.
      await this.applyAsyncRefundUpdate(event);
    } else if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.requires_action"
    ) {
      // Codex review fixes: explicitly enumerated, rather than "anything
      // that isn't refund.updated." ProviderEventType is an open string
      // union -- a real webhook endpoint can receive event types this
      // handler was never written for (e.g. charge.dispute.created,
      // customer.updated), and the OLD catch-all `else` treated every one
      // of those as a payment_intent failure/action event too. Worse:
      // event.paymentIntentId is undefined for those, and Prisma's `where`
      // silently DROPS a key whose value is `undefined` rather than
      // filtering for NULL -- `providerPaymentId: undefined` is not "no
      // match," it's "no filter on this field at all," so
      // payment.findFirst could return an arbitrary, unrelated Payment row
      // and this handler would then dispatch a status change onto the
      // WRONG order. Requiring event.paymentIntentId up front closes that
      // off entirely for events of a kind this handler doesn't recognize.
      if (!event.paymentIntentId) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "payment.webhook_missing_payment_intent_id.ignored",
            providerEventType: event.type,
            providerEventId: event.id,
          }),
        );
        return this.recordProcessedWebhookEvent(event.id);
      }

      let payment = await this.prisma.payment.findFirst({
        where: {
          provider: this.paymentProvider.name,
          providerPaymentId: event.paymentIntentId,
        },
      });
      // Round 2 review fixes: finalizeOrder requires a Payment row whose
      // providerPaymentId is already set -- if the process crashed after
      // the provider created/charged the PaymentIntent but before
      // completeCheckout ever persisted that link locally, AND nothing
      // ever retries checkout, the ONLY thing that arrives again is this
      // exact webhook. Before this fix, that meant "Payment was not
      // found" forever. Phase 1 always creates the TicketOrder and its
      // Payment row together (see createCheckout), so by the time ANY
      // payment_intent.succeeded webhook can reference this ticketOrderId
      // via metadata, that row is guaranteed to exist -- enough to
      // reconstruct the missing link using the webhook's own
      // independently-known PaymentIntent id.
      if (!payment && event.type === "payment_intent.succeeded" && event.metadata?.ticketOrderId) {
        await this.ensurePaymentLinkedFromWebhook(event.metadata.ticketOrderId, event.paymentIntentId);
        payment = await this.prisma.payment.findFirst({
          where: {
            provider: this.paymentProvider.name,
            providerPaymentId: event.paymentIntentId,
          },
        });
      }
      if (payment?.restaurantTabId) {
        await this.applyRestaurantPaymentWebhook(payment, event);
        return this.recordProcessedWebhookEvent(event.id);
      }
      if (!payment?.ticketOrderId) throw TicketingError.notFound("Payment was not found.");
      if (event.type === "payment_intent.succeeded") {
        await this.finalizeOrder(payment.ticketOrderId);
      } else {
        // Codex review fixes: guarded, forward-only transitions. Without
        // these guards, a delayed/out-of-order payment_intent.payment_failed
        // or .requires_action webhook (redelivered, or simply arriving
        // late relative to a payment_intent.succeeded that already
        // finalized this order) would downgrade an already-PAID order and
        // its already-SUCCEEDED/REFUNDED payment back to an earlier
        // state. Once either side has reached a resolved outcome, a stale
        // non-succeeded webhook must be a no-op.
        //
        // The TicketOrder guard checks its OWN status AND its Payment's
        // live status (via a relation filter, not the `payment` variable
        // captured above -- that read happened before this transaction
        // and would reintroduce the exact race being closed here).
        // finalizeOrder deliberately flips Payment to SUCCEEDED in its own
        // transaction BEFORE the ticket-issuing transaction reaches PAID
        // (Payment.status is decoupled from ticket issuance) -- so there is
        // a real, reachable window where Payment is already SUCCEEDED
        // while TicketOrder is still AWAITING_PAYMENT. TicketOrder's own
        // exclusion list alone does not cover that window; a stale failure
        // webhook landing in it would otherwise still downgrade the order
        // even though the payment genuinely succeeded.
        const paymentNotResolved = {
          notIn: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED],
        };
        await this.prisma.$transaction([
          this.prisma.payment.updateMany({
            where: { id: payment.id, status: paymentNotResolved },
            data: {
              status:
                event.type === "payment_intent.payment_failed"
                  ? PaymentStatus.FAILED
                  : PaymentStatus.REQUIRES_ACTION,
            },
          }),
          this.prisma.ticketOrder.updateMany({
            where: {
              id: payment.ticketOrderId,
              status: {
                notIn: [
                  TicketOrderStatus.PAID,
                  TicketOrderStatus.EXPIRED,
                  TicketOrderStatus.PARTIALLY_REFUNDED,
                  TicketOrderStatus.REFUNDED,
                  TicketOrderStatus.EXCHANGED,
                ],
              },
              payment: { status: paymentNotResolved },
            },
            data: {
              status:
                event.type === "payment_intent.payment_failed"
                  ? TicketOrderStatus.PAYMENT_FAILED
                  : TicketOrderStatus.AWAITING_PAYMENT,
            },
          }),
        ]);
      }
    }
    // Codex review fixes: any event type that isn't refund.updated or a
    // recognized payment_intent.* type (e.g. charge.dispute.created,
    // customer.updated -- anything else this webhook endpoint might
    // receive) falls through here as an intentional no-op, recorded as
    // processed below like everything else so it's never redelivered
    // forever.
    return this.recordProcessedWebhookEvent(event.id);
  }

  /**
   * Codex review fixes: extracted so both the normal end-of-function path
   * and the early-return for a recognized-but-unusable event (missing
   * paymentIntentId) go through the exact same dedup-recording logic,
   * rather than duplicating the P2002-as-"already processed" handling.
   */
  private async recordProcessedWebhookEvent(providerEventId: string): Promise<{ duplicate: boolean }> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: {
          provider: this.paymentProvider.name,
          providerEventId,
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

  private async applyRestaurantPaymentWebhook(
    payment: {
      id: string;
      restaurantTabId: string | null;
      status: PaymentStatus;
    },
    event: VerifiedProviderEvent,
  ) {
    if (!payment.restaurantTabId) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "restaurant_tabs" WHERE "id" = ${payment.restaurantTabId} FOR UPDATE`,
      );
      const tab = await tx.restaurantTab.findUnique({
        where: { id: payment.restaurantTabId! },
        include: { payments: true, receipt: true },
      });
      if (!tab || tab.status === "CLOSED") return;
      const nextPaymentStatus =
        event.type === "payment_intent.succeeded"
          ? PaymentStatus.SUCCEEDED
          : event.type === "payment_intent.payment_failed"
            ? PaymentStatus.FAILED
            : PaymentStatus.REQUIRES_ACTION;
      if (
        !new Set<PaymentStatus>([
          PaymentStatus.SUCCEEDED,
          PaymentStatus.REFUNDED,
          PaymentStatus.PARTIALLY_REFUNDED,
        ]).has(payment.status)
      ) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: nextPaymentStatus },
        });
      }
      const resolvedPayment = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const succeededPayments = await tx.payment.findMany({
        where: {
          restaurantTabId: tab.id,
          status: PaymentStatus.SUCCEEDED,
        },
      });
      const paidCents = succeededPayments.reduce(
        (sum, candidate) => sum + candidate.amountCents,
        0,
      );
      if (
        resolvedPayment.status === PaymentStatus.SUCCEEDED &&
        paidCents >= (tab.totalCents ?? 0)
      ) {
        const closedAt = new Date();
        await tx.restaurantTab.update({
          where: { id: tab.id },
          data: { status: "CLOSED", closedAt },
        });
        if (!tab.receipt) {
          await tx.restaurantReceipt.create({
            data: {
              restaurantTabId: tab.id,
              receiptNumber: `R-${closedAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
              subtotalCents: tab.subtotalCents ?? 0,
              taxCents: tab.taxCents ?? 0,
              serviceChargeCents: tab.serviceChargeCents ?? 0,
              tipCents: tab.selectedTipCents ?? 0,
              totalCents: tab.totalCents ?? 0,
              tenderSummary: succeededPayments.map((candidate) => ({
                amountCents: candidate.amountCents,
                paymentMethodReferenceId: candidate.paymentMethodReferenceId,
              })),
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "restaurant_tab.closed_from_payment_webhook",
            entityType: "RestaurantTab",
            entityId: tab.id,
            locationId: tab.locationId,
            afterState: { status: "CLOSED", paidCents },
          },
        });
      } else if (
        new Set<PaymentStatus>([
          PaymentStatus.FAILED,
          PaymentStatus.REQUIRES_ACTION,
          PaymentStatus.REQUIRES_PAYMENT_METHOD,
          PaymentStatus.CANCELED,
        ]).has(resolvedPayment.status)
      ) {
        await tx.restaurantTab.update({
          where: { id: tab.id },
          data: { status: "PAYMENT_FAILED" },
        });
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "restaurant_tab.payment_failed",
            entityType: "RestaurantTab",
            entityId: tab.id,
            locationId: tab.locationId,
            afterState: { paymentId: payment.id, providerEventId: event.id },
          },
        });
      }
    });
  }

  verifyAndProcessWebhook(rawBody: Buffer, signatureHeader: string) {
    const event = this.paymentProvider.verifyWebhookSignature({
      rawBody,
      signatureHeader,
    });
    return this.processVerifiedWebhook(event);
  }

  /**
   * Round 2 review fixes: reconstructs the Payment row's providerPaymentId
   * (and the missing first PaymentAttempt) from a payment_intent.succeeded
   * webhook's own known PaymentIntent id, ONLY if completeCheckout never
   * got to persist it. A no-op (a single indexed lookup) on the
   * overwhelmingly common path where that already happened normally.
   */
  private async ensurePaymentLinkedFromWebhook(ticketOrderId: string, providerIntentId: string): Promise<void> {
    const existingAttempt = await this.prisma.paymentAttempt.findUnique({
      where: {
        provider_providerIntentId: { provider: this.paymentProvider.name, providerIntentId },
      },
    });
    if (existingAttempt) return;

    const order = await this.prisma.ticketOrder.findUnique({
      where: { id: ticketOrderId },
      include: { payment: true },
    });
    if (!order?.payment) return; // Shouldn't happen -- see this function's call site; processVerifiedWebhook's own not-found handling covers a genuinely missing order the same way it already did.

    try {
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: order.payment.id },
          data: { providerPaymentId: providerIntentId },
        }),
        this.prisma.paymentAttempt.create({
          data: {
            paymentId: order.payment.id,
            provider: this.paymentProvider.name,
            providerIntentId,
            attemptNumber: 1,
          },
        }),
      ]);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // Concurrent reconstruction (a redelivered copy of this same
      // webhook), or completeCheckout's own phase finishing at the same
      // moment, already recorded it -- fine either way.
    }
  }

  /**
   * Round 2 review fixes: applies a `refund.updated` webhook to the local
   * Refund row it corresponds to. Correlates by metadata.refundId set at
   * settlement time (settleRefund) first -- works even if this row's
   * providerRefundId was never persisted locally (the exact crash
   * reconcilePendingRefunds also exists to recover from) -- falling back
   * to providerRefundId for any refund object that arrives without it.
   */
  private async applyAsyncRefundUpdate(event: VerifiedProviderEvent): Promise<void> {
    const refundEvent = event.refund;
    if (!refundEvent) return;
    const localRefund = refundEvent.metadata?.refundId
      ? await this.prisma.refund.findUnique({
          where: { id: refundEvent.metadata.refundId },
          include: { payment: { include: { ticketOrder: true } } },
        })
      : await this.prisma.refund.findFirst({
          where: { providerRefundId: refundEvent.providerRefundId },
          include: { payment: { include: { ticketOrder: true } } },
        });
    if (!localRefund) return;
    if (localRefund.status !== RefundStatus.CREATED && localRefund.status !== RefundStatus.PROCESSING) return;

    const mapped = refundStatusFromProvider(refundEvent.status);
    if (mapped === RefundStatus.PROCESSING) return; // still not resolved -- nothing to update yet.

    await this.prisma.$transaction(async (tx) => {
      // Codex review fixes: guarded on "still non-terminal" (CREATED or
      // PROCESSING), not merely "not already at this exact status." A
      // guard of `status: { not: mapped }` would still let a SUCCEEDED row
      // be overwritten to FAILED (or vice versa) if this webhook is racing
      // a concurrent settleRefund call (refundUnavailableOrder or
      // reconcilePendingRefunds) that already wrote the OTHER terminal
      // outcome first -- once ANY terminal status has been recorded, it
      // must never be replaced by a different one arriving late, in
      // either direction.
      const updated = await tx.refund.updateMany({
        where: { id: localRefund.id, status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } },
        data: { status: mapped, providerRefundId: refundEvent.providerRefundId, leaseExpiresAt: null },
      });
      // Codex review fixes: this whole block -- the Payment write below
      // AND the audit alert further down -- must only run when THIS call
      // actually won the race above (`updated.count > 0`). The refund
      // write was already correctly guarded, but the Payment write here
      // previously ran unconditionally whenever `mapped === SUCCEEDED`,
      // with no check on whether the refund write actually took effect.
      // In the exact race window this is meant to close -- this webhook
      // loses to a concurrent settleRefund call that already recorded a
      // DIFFERENT terminal outcome (e.g. FAILED) -- the Refund row would
      // correctly stay FAILED while Payment got incorrectly flipped to
      // REFUNDED anyway, leaving the two permanently inconsistent.
      if (updated.count === 0) return;
      if (mapped === RefundStatus.SUCCEEDED) {
        await tx.payment.updateMany({
          where: { id: localRefund.paymentId, status: { not: PaymentStatus.REFUNDED } },
          data: { status: PaymentStatus.REFUNDED },
        });
      }
      // Codex review fixes: a refund can also reach terminal FAILED via
      // an asynchronous refund.updated webhook (not just a thrown
      // ProviderDefinitiveError or a normal synchronous provider
      // response) -- same alerting obligation applies.
      if (mapped === RefundStatus.FAILED && localRefund.payment?.ticketOrder) {
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "payment.refund_attention_required",
            entityType: "Refund",
            entityId: localRefund.id,
            locationId: localRefund.payment.ticketOrder.locationId,
            afterState: { paymentId: localRefund.paymentId, providerStatus: refundEvent.status },
          },
        });
      }
    });
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
      // Codex review fixes: NOT leased here. `upsert`'s `update: {}` only
      // get-or-creates -- a caller that lands on an ALREADY-existing row
      // (a concurrent call for the same order/payment) would otherwise
      // proceed to call the provider without ever having actually claimed
      // it. The lease is claimed as its own explicit, conditional step
      // right after this transaction commits, below, so a freshly-created
      // row and a rediscovered existing row go through the identical
      // exclusive-claim gate.
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
      // Codex review fixes: never downgrade a refund that has already
      // completed (or partially completed) back to SUCCEEDED -- a repeat
      // call reaching this point after the refund already resolved (e.g.
      // a redelivered webhook, or a retried finalize hitting the same
      // seat-unavailable/hold-expired guard again) must not erase that.
      await tx.payment.updateMany({
        where: {
          id: locked.payment.id,
          status: { notIn: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        data: { status: PaymentStatus.SUCCEEDED },
      });
      return { locked, refund };
    });

    // Codex review fixes: only CREATED/PROCESSING refunds are ours to
    // settle here -- SUCCEEDED and FAILED are both terminal (a FAILED
    // refund is a confirmed processor rejection; retrying the identical
    // request would only hit the same rejection again, and
    // reconcilePendingRefunds never revisits FAILED rows either, for the
    // same reason).
    if (recovery.refund.status !== RefundStatus.CREATED && recovery.refund.status !== RefundStatus.PROCESSING) {
      return;
    }

    // Codex review fixes: the actual exclusive claim -- mirrors
    // reconcilePendingRefunds' own conditional-updateMany claim exactly,
    // so a concurrent refundUnavailableOrder call for the same
    // order/payment, or an overlapping reconciliation sweep, cannot also
    // act on this row at the same time. If this loses the race, whoever
    // DID claim it (or already did) is responsible for settling it.
    const claim = await this.prisma.refund.updateMany({
      where: {
        id: recovery.refund.id,
        status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      data: { leaseExpiresAt: new Date(Date.now() + REFUND_LEASE_MS) },
    });
    if (claim.count === 0) return;

    await this.settleRefund(
      { id: recovery.refund.id, paymentId: recovery.locked.payment!.id },
      recovery.refund.providerRefundId,
      {
        connectedAccountId: recovery.locked.location.organization.stripeConnectedAccountId ?? undefined,
        providerPaymentId: recovery.locked.payment!.providerPaymentId!,
        amountCents: recovery.refund.amountCents,
        reason,
        ticketOrderId: recovery.locked.id,
        locationId: recovery.locked.locationId,
      },
    );
  }

  /**
   * Round 2 review fixes: operational entry point for resuming a refund
   * whose owning process died before ever calling the provider, or after
   * the provider responded but before the local status update committed.
   * Meant to be invoked periodically by an external scheduler (see
   * apps/api's RefundReconciliationService) as the durable safety net
   * alongside the real-time refund.updated webhook handling above.
   *
   * Safe to call concurrently with itself -- each row's lease is claimed
   * with a conditional updateMany, so two overlapping reconciliation
   * passes (or a pass overlapping a live refundUnavailableOrder call for
   * the same refund) can't both act on the same row at once.
   */
  async reconcilePendingRefunds(
    options: { leaseDurationMs?: number; now?: Date } = {},
  ): Promise<{ reconciled: number; stillPending: number }> {
    const now = options.now ?? new Date();
    const leaseDurationMs = options.leaseDurationMs ?? REFUND_LEASE_MS;
    const pendingStatuses = [RefundStatus.CREATED, RefundStatus.PROCESSING];

    const candidates = await this.prisma.refund.findMany({
      where: {
        status: { in: pendingStatuses },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      include: {
        payment: {
          include: {
            attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
            ticketOrder: { include: { location: { include: { organization: true } } } },
          },
        },
      },
    });

    let reconciled = 0;
    let stillPending = 0;

    for (const candidate of candidates) {
      const leaseUntil = new Date(now.getTime() + leaseDurationMs);
      const claim = await this.prisma.refund.updateMany({
        where: {
          id: candidate.id,
          status: { in: pendingStatuses },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        data: { leaseExpiresAt: leaseUntil },
      });
      if (claim.count === 0) continue; // Lost the claim race to a concurrent reconciliation pass.

      const attempt = candidate.payment.attempts[0];
      const ticketOrder = candidate.payment.ticketOrder;
      if (!attempt?.providerIntentId || !ticketOrder) {
        // Nothing usable to act on -- release the lease rather than
        // holding it on a row this pass can't process anyway.
        await this.prisma.refund.updateMany({ where: { id: candidate.id }, data: { leaseExpiresAt: null } });
        continue;
      }

      try {
        const status = await this.settleRefund(
          { id: candidate.id, paymentId: candidate.paymentId },
          candidate.providerRefundId,
          {
            connectedAccountId: ticketOrder.location.organization.stripeConnectedAccountId ?? undefined,
            providerPaymentId: attempt.providerIntentId,
            amountCents: candidate.amountCents,
            reason: candidate.reason,
            ticketOrderId: ticketOrder.id,
            locationId: ticketOrder.locationId,
          },
        );
        if (status === RefundStatus.PROCESSING) stillPending += 1;
        else reconciled += 1;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({ event: "refund.reconcile_failed", refundId: candidate.id, error: String(error) }),
        );
        // Lease still holds until it naturally expires -- the next pass retries.
      }
    }

    return { reconciled, stillPending };
  }

  /**
   * Calls the payment provider for a Refund row this process already owns
   * the claim on (via the (paymentId, reason)-derived idempotencyKey
   * unique-constraint win in refundUnavailableOrder, or via the lease
   * claim in reconcilePendingRefunds) and persists whatever the provider
   * actually reports.
   *
   * `existingProviderRefundId` distinguishes "we don't yet know if the
   * provider was ever called" (null -- use refund(), whose idempotencyKey
   * makes this safe even if a previous, uncommitted attempt already
   * reached the provider) from "we already know the provider's refund id,
   * just not its current status" (non-null -- use retrieveRefund for the
   * LIVE status, since a replayed refund() call would only return the
   * response cached from the original creation, not a later async
   * pending -> succeeded/failed transition).
   */
  private async settleRefund(
    refund: { id: string; paymentId: string },
    existingProviderRefundId: string | null,
    ctx: {
      connectedAccountId?: string;
      providerPaymentId: string;
      amountCents: number;
      reason: string;
      ticketOrderId: string;
      locationId: string;
    },
  ): Promise<RefundStatus> {
    const idempotencyKey = `seat-unavailable-refund:${refund.paymentId}`;

    // Round 2 review fixes: a thrown provider error does NOT by itself
    // mean the refund failed -- a network timeout, a connection reset, or
    // a 5xx from the processor's own servers can all throw here while the
    // request was actually received and processed before the response was
    // lost in transit. Only a ProviderDefinitiveError -- thrown by the
    // provider implementation ONLY when the processor positively
    // confirmed a rejection -- means retrying can never succeed. Anything
    // else is an UNKNOWN outcome, not a failed one.
    let result;
    try {
      result = existingProviderRefundId
        ? await this.paymentProvider.retrieveRefund({
            connectedAccountId: ctx.connectedAccountId,
            providerRefundId: existingProviderRefundId,
          })
        : await this.paymentProvider.refund({
            connectedAccountId: ctx.connectedAccountId,
            providerPaymentId: ctx.providerPaymentId,
            amountCents: ctx.amountCents,
            reason: ctx.reason,
            idempotencyKey,
            metadata: { ticketOrderId: ctx.ticketOrderId, refundId: refund.id },
          });
    } catch (error) {
      if (!(error instanceof ProviderDefinitiveError)) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            event: "payment.refund_provider_call_ambiguous.retry_required",
            refundId: refund.id,
            paymentId: refund.paymentId,
            error: String(error),
          }),
        );
        // Codex review fixes: release the claim immediately rather than
        // leaving it held for the rest of its lease -- this process is no
        // longer actively handling the refund (the provider call itself
        // failed ambiguously), so the next reconciliation sweep (or
        // another retry) should be able to pick it up right away instead
        // of waiting out a lease nobody is still working. Status is left
        // exactly as it was (still CREATED/PROCESSING); only the claim is
        // released.
        await this.prisma.refund.updateMany({
          where: { id: refund.id, status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } },
          data: { leaseExpiresAt: null },
        });
        return RefundStatus.PROCESSING;
      }

      // A genuine, confirmed rejection from the processor -- this, and
      // only this, is a real terminal failure. Codex review fixes: guarded
      // the same way as the returned-FAILED branch below -- only
      // transition FROM a still-open (CREATED/PROCESSING) row. A
      // concurrent settleRefund call or refund.updated webhook may have
      // already recorded a DIFFERENT (correct) terminal outcome for this
      // exact row while this provider call was in flight; that must never
      // be overwritten by a stale/contradictory rejection arriving after
      // the fact. If this call loses that race, report the outcome that
      // actually won, not the rejection this call itself observed.
      const failureMessage = error.message;
      return this.prisma.$transaction(async (tx) => {
        // Match refundUnavailableOrder's lock order: ticket order first,
        // then refund/payment rows. Otherwise concurrent recovery can hold
        // the order while this transaction holds Refund/Payment, leaving
        // each side waiting on the other until Postgres aborts one.
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${ctx.ticketOrderId} FOR UPDATE`,
        );
        const updated = await tx.refund.updateMany({
          where: { id: refund.id, status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } },
          data: { status: RefundStatus.FAILED, leaseExpiresAt: null },
        });
        await tx.ticketOrder.update({ where: { id: ctx.ticketOrderId }, data: { status: TicketOrderStatus.EXPIRED } });
        if (updated.count === 0) {
          const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
          return current.status;
        }
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            action: "payment.refund_attention_required",
            entityType: "Refund",
            entityId: refund.id,
            locationId: ctx.locationId,
            afterState: { reason: ctx.reason, paymentId: refund.paymentId, failureMessage },
          },
        });
        return RefundStatus.FAILED;
      });
    }

    const mapped = refundStatusFromProvider(result.status);
    let settled: RefundStatus;
    try {
      settled = await this.prisma.$transaction(async (tx) => {
        // Keep the row-lock order consistent with refundUnavailableOrder so
        // a concurrent finalize waits before either transaction owns
        // Refund or Payment locks instead of forming a deadlock cycle.
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${ctx.ticketOrderId} FOR UPDATE`,
        );
        // Codex review fixes: guarded on "still non-terminal", not merely
        // "not already at this exact status" -- see applyAsyncRefundUpdate's
        // matching comment. A concurrent refund.updated webhook (or another
        // settleRefund call) may have already recorded a DIFFERENT terminal
        // outcome for this row while this provider call was in flight; once
        // any terminal status is recorded, it must never be replaced by a
        // different one arriving late, in either direction.
        const updated = await tx.refund.updateMany({
          where: { id: refund.id, status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } },
          data: { status: mapped, providerRefundId: result.id, leaseExpiresAt: null },
        });
        if (updated.count === 0) {
          const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
          return current.status;
        }
        if (mapped === RefundStatus.SUCCEEDED) {
          await tx.payment.updateMany({
            where: { id: refund.paymentId, status: { not: PaymentStatus.REFUNDED } },
            data: { status: PaymentStatus.REFUNDED },
          });
        }
        await tx.ticketOrder.update({ where: { id: ctx.ticketOrderId }, data: { status: TicketOrderStatus.EXPIRED } });
        // Codex review fixes: a refund can reach terminal FAILED via a
        // normal (non-throwing) provider response too, not only a thrown
        // ProviderDefinitiveError above -- that must alert the same way,
        // since either path means the same thing operationally (the
        // charge could not be refunded and needs a human). Only reached
        // when `updated.count > 0` above -- i.e. THIS call is the one that
        // actually transitioned the row into FAILED -- so a redundant call
        // against an already-resolved row never creates a duplicate alert.
        if (mapped === RefundStatus.FAILED) {
          await tx.auditEvent.create({
            data: {
              actorType: "SYSTEM",
              action: "payment.refund_attention_required",
              entityType: "Refund",
              entityId: refund.id,
              locationId: ctx.locationId,
              afterState: { reason: ctx.reason, paymentId: refund.paymentId, providerStatus: result.status },
            },
          });
        }
        return mapped;
      });
    } catch (persistError) {
      // The provider already gave a definitive, known answer -- we just
      // failed to write it down. This must NEVER become FAILED: the
      // refund may well have genuinely succeeded on the processor's side,
      // and recording FAILED here would both lie about that and make the
      // row unreachable to reconcilePendingRefunds forever (it only
      // revisits CREATED/PROCESSING rows). The Refund row is untouched by
      // this failed transaction, so the honest thing to report is
      // PROCESSING -- reconcilePendingRefunds (once its lease expires) or
      // the async refund.updated webhook will observe the SAME real
      // outcome on the next attempt.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "payment.refund_persist_failed.retry_required",
          refundId: refund.id,
          paymentId: refund.paymentId,
          providerRefundId: result.id,
          providerStatus: result.status,
          error: String(persistError),
        }),
      );
      return RefundStatus.PROCESSING;
    }

    if (settled === RefundStatus.PROCESSING) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "payment.refund_not_confirmed.manual_review_required",
          refundId: refund.id,
          paymentId: refund.paymentId,
          providerStatus: result.status,
        }),
      );
    }
    return settled;
  }

  private presentCheckout(
    order: {
      id: string;
      orderNumber: string;
      status: TicketOrderStatus;
      guestEmail: string | null;
      guestName: string | null;
      subtotalCents: number;
      discountCents: number;
      feesCents: number;
      taxCents: number;
      orderAheadSubtotalCents: number;
      orderAheadTaxCents: number;
      orderAheadServiceChargeCents: number;
      totalCents: number;
      giftCardCents: number;
      currency: string;
      payment: {
        id: string;
        amountCents: number;
        providerPaymentId: string | null;
        status: PaymentStatus;
        attempts: Array<{ attemptNumber: number; status: PaymentAttemptStatus }>;
      } | null;
    },
    promotion: { code: string; name: string } | null,
    clientSecret?: string,
    providerStatus?: string,
  ) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      email: order.guestEmail,
      name: order.guestName,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      feesCents: order.feesCents,
      taxCents: order.taxCents,
      orderAheadSubtotalCents: order.orderAheadSubtotalCents,
      orderAheadTaxCents: order.orderAheadTaxCents,
      orderAheadServiceChargeCents: order.orderAheadServiceChargeCents,
      totalCents: order.totalCents,
      giftCardCents: order.giftCardCents,
      currency: order.currency,
      promotion,
      payment: order.payment
        ? {
            id: order.payment.id,
            providerPaymentId: order.payment.providerPaymentId,
            status: providerStatus ?? order.payment.status,
            amountCents: order.payment.amountCents,
            clientSecret,
            attemptNumber: order.payment.attempts[0]?.attemptNumber ?? 0,
          }
        : null,
    };
  }

  private async deliverReceipt(order: {
    id: string;
    orderNumber: string;
    guestEmail: string | null;
    guestName: string | null;
    totalCents: number;
    currency: string;
    orderAheadItems: Prisma.JsonValue | null;
    orderAheadSubtotalCents: number;
    orderAheadTaxCents: number;
    orderAheadServiceChargeCents: number;
    receiptEmailSentAt: Date | null;
    tickets: Array<{
      id: string;
      qrToken: string;
      ticketType: { name: string };
      showtimeSeat: {
        seat: { label: string };
        showtime: {
          startsAt: Date;
          endsAt: Date;
          movie: { title: string };
          auditorium: {
            name: string;
            seatingMode: "RESERVED" | "GENERAL_ADMISSION";
          };
        };
      };
    }>;
  }): Promise<"SENT" | "FAILED" | "NOT_REQUESTED"> {
    if (!order.guestEmail) return "NOT_REQUESTED";
    if (order.receiptEmailSentAt) return "SENT";

    const now = new Date();
    const claimed = await this.prisma.ticketOrder.updateMany({
      where: {
        id: order.id,
        receiptEmailSentAt: null,
        OR: [
          { receiptEmailClaimedAt: null },
          { receiptEmailClaimedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
        ],
      },
      data: { receiptEmailClaimedAt: now, receiptEmailError: null },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.ticketOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { receiptEmailSentAt: true },
      });
      return current.receiptEmailSentAt ? "SENT" : "NOT_REQUESTED";
    }

    const orderAheadLines = persistedOrderAheadLines(order.orderAheadItems);
    const receipt: TicketReceipt = {
      to: order.guestEmail,
      guestName: order.guestName,
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      currency: order.currency,
      tickets: order.tickets.map((ticket) => ({
        id: ticket.id,
        credential: ticket.qrToken,
        movie: ticket.showtimeSeat.showtime.movie.title,
        auditorium: ticket.showtimeSeat.showtime.auditorium.name,
        seat:
          ticket.showtimeSeat.showtime.auditorium.seatingMode ===
          "GENERAL_ADMISSION"
            ? "General admission"
            : ticket.showtimeSeat.seat.label,
        ticketType: ticket.ticketType.name,
        startsAt: ticket.showtimeSeat.showtime.startsAt,
      })),
      orderAhead: orderAheadLines.length
        ? {
            subtotalCents: order.orderAheadSubtotalCents,
            taxCents: order.orderAheadTaxCents,
            serviceChargeCents: order.orderAheadServiceChargeCents,
            items: orderAheadLines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              totalCents: line.totalCents,
            })),
          }
        : undefined,
    };

    try {
      const delivery = await this.emailProvider.sendTicketReceipt(receipt);
      await this.prisma.ticketOrder.update({
        where: { id: order.id },
        data: {
          receiptEmailSentAt: new Date(),
          receiptEmailMessageId: delivery.messageId,
          receiptEmailClaimedAt: null,
          receiptEmailError: null,
        },
      });
      return "SENT";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email delivery error";
      await this.prisma.ticketOrder.update({
        where: { id: order.id },
        data: {
          receiptEmailClaimedAt: null,
          receiptEmailError: message.slice(0, 1000),
        },
      });
      return "FAILED";
    }
  }

  private async persistDiningAuthorization(
    order: {
      id: string;
      customerId: string | null;
      diningAuthorizationRequested: boolean | null;
      locationId: string;
    },
    paymentMethod: {
      id: string;
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    } | undefined,
  ): Promise<"AUTHORIZED" | "DECLINED" | "UNAVAILABLE"> {
    if (!order.customerId) return "UNAVAILABLE";
    const requested = order.diningAuthorizationRequested === true;
    const paymentCustomer = requested
      ? await this.prisma.paymentCustomer.findFirst({
          where: {
            customerId: order.customerId,
            organization: { locations: { some: { id: order.locationId } } },
            provider: this.paymentProvider.name,
          },
        })
      : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        let paymentMethodReferenceId: string | null = null;
        if (requested && paymentCustomer && paymentMethod) {
          await tx.paymentMethodReference.updateMany({
            where: { paymentCustomerId: paymentCustomer.id, isDefault: true },
            data: { isDefault: false },
          });
          const reference = await tx.paymentMethodReference.upsert({
            where: {
              paymentCustomerId_provider_providerPaymentMethodId: {
                paymentCustomerId: paymentCustomer.id,
                provider: this.paymentProvider.name,
                providerPaymentMethodId: paymentMethod.id,
              },
            },
            create: {
              paymentCustomerId: paymentCustomer.id,
              provider: this.paymentProvider.name,
              providerPaymentMethodId: paymentMethod.id,
              brand: paymentMethod.brand,
              last4: paymentMethod.last4,
              expMonth: paymentMethod.expMonth,
              expYear: paymentMethod.expYear,
              isDefault: true,
            },
            update: {
              brand: paymentMethod.brand,
              last4: paymentMethod.last4,
              expMonth: paymentMethod.expMonth,
              expYear: paymentMethod.expYear,
              active: true,
              isDefault: true,
            },
          });
          paymentMethodReferenceId = reference.id;
        }

        const granted = requested && paymentMethodReferenceId !== null;
        await tx.customerConsent.upsert({
          where: {
            ticketOrderId_type: {
              ticketOrderId: order.id,
              type: "DINING_AUTO_SETTLEMENT",
            },
          },
          create: {
            customerId: order.customerId!,
            type: "DINING_AUTO_SETTLEMENT",
            granted,
            termsVersion: DINING_CONSENT_TERMS_VERSION,
            grantedAt: new Date(),
            ticketOrderId: order.id,
            paymentMethodReferenceId,
          },
          update: {},
        });
        return granted ? "AUTHORIZED" : requested ? "UNAVAILABLE" : "DECLINED";
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      const concurrent = await this.prisma.customerConsent.findUnique({
        where: { ticketOrderId_type: { ticketOrderId: order.id, type: "DINING_AUTO_SETTLEMENT" } },
      });
      if (!concurrent) throw error;
      return concurrent.granted ? "AUTHORIZED" : requested ? "UNAVAILABLE" : "DECLINED";
    }
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
      ticketType: { name: string };
      showtimeSeat: {
        seat: { label: string };
        showtime: {
          startsAt: Date;
          endsAt: Date;
          movie: { title: string };
          auditorium: {
            name: string;
            seatingMode: "RESERVED" | "GENERAL_ADMISSION";
          };
        };
      };
    }>;
  },
  receiptDelivery: "SENT" | "FAILED" | "NOT_REQUESTED",
  diningAuthorization: "AUTHORIZED" | "DECLINED" | "UNAVAILABLE",
  ) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalCents: order.totalCents,
      currency: order.currency,
      receiptDelivery,
      diningAuthorization,
      tickets: order.tickets.map((ticket) => ({
        id: ticket.id,
        issuanceToken: ticket.qrToken,
        seat:
          ticket.showtimeSeat.showtime.auditorium.seatingMode ===
          "GENERAL_ADMISSION"
            ? "General admission"
            : ticket.showtimeSeat.seat.label,
        ticketType: ticket.ticketType.name,
        movie: ticket.showtimeSeat.showtime.movie.title,
        auditorium: ticket.showtimeSeat.showtime.auditorium.name,
        startsAt: ticket.showtimeSeat.showtime.startsAt.toISOString(),
        endsAt: ticket.showtimeSeat.showtime.endsAt.toISOString(),
      })),
    };
  }
}
