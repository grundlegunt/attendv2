import { Inject, Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@cinema/database";
import { PaymentProvider } from "@cinema/payments";
import { createTicketCredential } from "@cinema/ticketing";
import { loadEnv } from "@cinema/config/env";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../common/app-error";
import { CinemaService } from "../cinema/cinema.service";
import { PAYMENT_PROVIDER } from "../payments/payments.module";

@Injectable()
export class BoxOfficeService {
  constructor(
    private readonly cinema: CinemaService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  holdSeats(showtimeId: string, seatIds: string[], holderKey: string) {
    return this.cinema.holdSeats(showtimeId, seatIds, holderKey);
  }

  async customerLookup(locationId: string, query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) throw AppError.validationFailed("Enter at least two characters.");
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { email: { contains: normalized, mode: "insensitive" } },
          { phone: { contains: normalized } },
          { name: { contains: normalized, mode: "insensitive" } },
        ],
        ticketOrders: { some: { locationId } },
      },
      select: { id: true, name: true, email: true, phone: true },
      take: 10,
      orderBy: { updatedAt: "desc" },
    });
    return customers.map((customer) => ({ ...customer, membership: null }));
  }

  giftCardBalance(locationId: string, code: string) {
    return this.cinema.giftCardBalance(locationId, code);
  }

  async quote(input: { locationId: string; holdTokens: string[]; holderKey: string; promotionCode?: string }) {
    const tokens = [...new Set(input.holdTokens)].sort();
    const now = new Date();
    const holds = await prisma.seatHold.findMany({
      where: { holdToken: { in: tokens } },
      include: { showtimeSeat: { include: { showtime: { include: { priceTier: true, auditorium: true } }, seat: true } } },
    });
    if (holds.length !== tokens.length || holds.some((hold) => hold.holderKey !== input.holderKey || hold.releasedAt || hold.expiresAt <= now)) {
      throw AppError.conflict("One or more seat holds have expired.");
    }
    if (holds.some((hold) => hold.showtimeSeat.showtime.auditorium.locationId !== input.locationId)) {
      throw AppError.notFound("Seat holds were not found.");
    }
    const showtimeIds = new Set(holds.map((hold) => hold.showtimeSeat.showtimeId));
    if (showtimeIds.size !== 1) throw AppError.validationFailed("All seats must be for one showtime.");
    const priceTier = holds[0]!.showtimeSeat.showtime.priceTier;
    const location = await prisma.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const subtotalCents = priceTier.ticketPriceMinor * holds.length;
    const feesCents = priceTier.feeMinor * holds.length;
    const promotion = input.promotionCode
      ? await prisma.promotion.findFirst({ where: { locationId: input.locationId, code: input.promotionCode.toUpperCase(), active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] }, include: { ticketOrders: { where: { status: { in: ["PAID", "EXCHANGED"] } }, select: { id: true } } } })
      : null;
    if (input.promotionCode && !promotion) throw AppError.notFound("Promotion was not found or is inactive.");
    if (promotion?.minimumSubtotalCents != null && subtotalCents < promotion.minimumSubtotalCents) throw AppError.validationFailed(`Promotion requires a minimum ticket subtotal of ${promotion.minimumSubtotalCents} cents.`);
    if (promotion?.maximumRedemptions != null && promotion.ticketOrders.length >= promotion.maximumRedemptions) throw AppError.conflict("Promotion redemption limit has been reached.");
    const discountCents = !promotion ? 0 : promotion.type === "COMP" ? subtotalCents : promotion.type === "FIXED_AMOUNT" ? Math.min(subtotalCents, promotion.amountCents ?? 0) : Math.min(subtotalCents, Math.round(subtotalCents * (promotion.percentageBasisPoints ?? 0) / 10_000));
    const taxableSubtotal = subtotalCents - discountCents;
    const taxCents = Math.round(taxableSubtotal * location.ticketTaxRateBasisPoints / 10_000);
    return {
      showtimeId: holds[0]!.showtimeSeat.showtimeId,
      seats: holds.map((hold) => ({ id: hold.showtimeSeat.seatId, label: hold.showtimeSeat.seat.label })),
      subtotalCents, discountCents, feesCents, taxCents,
      totalCents: taxableSubtotal + feesCents + taxCents,
      currency: priceTier.currency,
      promotion: promotion ? { id: promotion.id, code: promotion.code, name: promotion.name } : null,
    };
  }

  async checkout(input: {
    requestId: string; locationId: string; employeeId: string;
    holdTokens: string[]; holderKey: string; ticketTypeId: string;
    promotionCode?: string; cashDrawerId?: string; cashCents: number;
    cardCents: number; giftCardCents: number; giftCardCode?: string; readerId?: string; cashReceivedCents?: number;
    customerEmail?: string; customerName?: string;
  }) {
    const existing = await prisma.ticketOrder.findUnique({
      where: { checkoutIdempotencyKey: input.requestId },
      include: { tickets: { include: { showtimeSeat: { include: { seat: true } } } }, payment: true, cashTransactions: true },
    });
    if (existing?.status === "PAID") return existing;
    const quote = await this.quote(input);
    if (input.cashCents + input.cardCents + input.giftCardCents !== quote.totalCents) {
      throw AppError.validationFailed(`Tender amounts must total ${quote.totalCents} cents.`);
    }
    if (input.cashCents > 0 && (input.cashReceivedCents ?? 0) < input.cashCents) {
      throw AppError.validationFailed("Cash received must cover the cash tender.");
    }
    const ticketType = await prisma.ticketType.findFirst({ where: { id: input.ticketTypeId, locationId: input.locationId, active: true } });
    if (!ticketType) throw AppError.notFound("Ticket type was not found.");
    if (input.cashCents > 0) {
      const drawer = await prisma.cashDrawer.findFirst({ where: { id: input.cashDrawerId, locationId: input.locationId, status: "OPEN" } });
      if (!drawer) throw AppError.notFound("Open cash drawer not found.");
    }
    const location = await prisma.location.findUnique({ where: { id: input.locationId }, include: { organization: true } });
    if (!location) throw AppError.notFound("Location was not found.");
    if (input.giftCardCents > 0) {
      const giftCard = await this.cinema.giftCardBalance(input.locationId, input.giftCardCode!);
      if (giftCard.currency !== quote.currency) throw AppError.validationFailed("Gift card currency does not match this sale.");
      if (giftCard.balanceCents < input.giftCardCents) throw AppError.paymentRequired("Gift card balance is insufficient.");
    }
    const customer = input.customerEmail ? await prisma.customer.upsert({
      where: { email: input.customerEmail.toLowerCase() },
      create: { email: input.customerEmail.toLowerCase(), name: input.customerName, isGuest: true },
      update: input.customerName ? { name: input.customerName } : {},
    }) : null;
    const order = existing ?? await prisma.ticketOrder.create({
      data: {
        locationId: input.locationId, customerId: customer?.id, ticketTypeId: ticketType.id,
        holdTokens: [...new Set(input.holdTokens)].sort(), holderKey: input.holderKey,
        guestEmail: input.customerEmail?.toLowerCase(), guestName: input.customerName,
        channel: "BOX_OFFICE", status: "AWAITING_PAYMENT",
        orderNumber: `AT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`,
        checkoutIdempotencyKey: input.requestId, subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents, feesCents: quote.feesCents, taxCents: quote.taxCents,
        totalCents: quote.totalCents, currency: quote.currency, promotionId: quote.promotion?.id,
        placedByEmployeeId: input.employeeId,
        ...(input.cardCents > 0 ? { payment: { create: {
          purpose: "TICKET_ORDER", amountCents: input.cardCents, currency: quote.currency,
          status: "CREATED", idempotencyKey: `box-office-card:${input.requestId}`, provider: this.paymentProvider.name,
        } } } : {}),
      },
      include: { payment: true },
    });

    let cardResult = null;
    if (input.cardCents > 0) {
      cardResult = await this.paymentProvider.collectCardPresentPayment({
        connectedAccountId: location.organization.stripeConnectedAccountId ?? undefined,
        readerId: input.readerId!, amountCents: input.cardCents, currency: quote.currency,
        metadata: { ticketOrderId: order.id, channel: "BOX_OFFICE" },
        idempotencyKey: `box-office-card:${input.requestId}`,
      });
      await prisma.payment.update({
        where: { id: order.payment!.id },
        data: { providerPaymentId: cardResult.id, status: cardResult.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
          attempts: { create: { provider: this.paymentProvider.name, providerIntentId: cardResult.id, attemptNumber: 1, status: cardResult.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED", failureCode: cardResult.failureCode, failureMessage: cardResult.failureMessage } } },
      });
      if (cardResult.status !== "SUCCEEDED") {
        await prisma.ticketOrder.update({ where: { id: order.id }, data: { status: "PAYMENT_FAILED" } });
        throw AppError.paymentRequired(cardResult.failureMessage ?? "Card payment was not successful.");
      }
    }

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${order.id} FOR UPDATE`);
        const lockedOrder = await tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
        if (lockedOrder.status === "PAID") return tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: { include: { showtimeSeat: { include: { seat: true } } } }, payment: true, cashTransactions: true } });
        const lockedHolds = await tx.$queryRaw<Array<{ id: string; showtimeSeatId: string; holderKey: string; expiresAt: Date; releasedAt: Date | null }>>(Prisma.sql`
          SELECT sh."id", sh."showtimeSeatId", sh."holderKey", sh."expiresAt", sh."releasedAt"
          FROM "seat_holds" sh JOIN "showtime_seats" ss ON ss."id" = sh."showtimeSeatId"
          WHERE sh."holdToken" IN (${Prisma.join(lockedOrder.holdTokens)}) ORDER BY ss."id" FOR UPDATE OF ss, sh
        `);
        const now = new Date();
        if (lockedHolds.length !== lockedOrder.holdTokens.length || lockedHolds.some((hold) => hold.holderKey !== lockedOrder.holderKey || hold.releasedAt || hold.expiresAt <= now)) {
          throw AppError.conflict("The seat hold expired before payment could be finalized.");
        }
        const inventoryIds = lockedHolds.map((hold) => hold.showtimeSeatId);
        if (await tx.ticket.findFirst({ where: { showtimeSeatId: { in: inventoryIds }, status: { notIn: ["REFUNDED", "CANCELED"] } } })) {
          throw AppError.conflict("A selected seat is no longer available.");
        }
        if (input.giftCardCents > 0) {
          const codeHash = createHash("sha256").update(input.giftCardCode!.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
          const cardId = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "gift_cards" WHERE "codeHash" = ${codeHash} FOR UPDATE`);
          const giftCard = cardId[0] ? await tx.giftCard.findFirst({ where: { id: cardId[0].id, organizationId: location.organizationId, status: "ACTIVE" } }) : null;
          if (!giftCard) throw AppError.notFound("Gift card was not found or is inactive.");
          if (giftCard.currency !== quote.currency) throw AppError.validationFailed("Gift card currency does not match this sale.");
          if (giftCard.balanceCents < input.giftCardCents) throw AppError.paymentRequired("Gift card balance is insufficient.");
          const balanceAfterCents = giftCard.balanceCents - input.giftCardCents;
          await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: balanceAfterCents } });
          await tx.giftCardTransaction.create({ data: { giftCardId: giftCard.id, locationId: input.locationId, employeeId: input.employeeId, type: "REDEMPTION", amountCents: -input.giftCardCents, balanceAfterCents, reference: order.id } });
        }
        const perTicketPrice = Math.floor((lockedOrder.subtotalCents - lockedOrder.discountCents) / lockedHolds.length);
        await tx.ticket.createMany({ data: lockedHolds.map((hold) => {
          const id = randomUUID();
          return { id, ticketOrderId: order.id, showtimeSeatId: hold.showtimeSeatId, ticketTypeId: lockedOrder.ticketTypeId, priceCentsPaid: perTicketPrice, qrToken: createTicketCredential(id, loadEnv().QR_CREDENTIAL_SECRET) };
        }) });
        await tx.seatHold.updateMany({ where: { id: { in: lockedHolds.map((hold) => hold.id) }, releasedAt: null }, data: { releasedAt: now } });
        if (input.cashCents > 0) {
          await tx.$queryRaw`SELECT "id" FROM "cash_drawers" WHERE "id" = ${input.cashDrawerId!} FOR UPDATE`;
          const drawer = await tx.cashDrawer.findFirst({ where: { id: input.cashDrawerId, locationId: input.locationId, status: "OPEN" } });
          if (!drawer) throw AppError.conflict("The cash drawer was closed before checkout completed.");
          await tx.cashTransaction.create({ data: {
            locationId: input.locationId, cashDrawerId: drawer.id, ticketOrderId: order.id,
            employeeId: input.employeeId, type: "SALE", amountCents: input.cashCents,
            cashReceivedCents: input.cashReceivedCents, changeGivenCents: (input.cashReceivedCents ?? input.cashCents) - input.cashCents,
            idempotencyKey: `box-office-cash:${input.requestId}`,
          } });
        }
        await tx.ticketOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
        await tx.auditEvent.create({ data: {
          actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
          action: "ticket_order.box_office_sold", entityType: "TicketOrder", entityId: order.id,
          afterState: { status: "PAID", cashCents: input.cashCents, cardCents: input.cardCents, giftCardCents: input.giftCardCents, seatCount: lockedHolds.length },
        } });
        return tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: { include: { showtimeSeat: { include: { seat: true } } } }, payment: true, cashTransactions: true } });
      });
    } catch (error) {
      if (cardResult?.status === "SUCCEEDED") await this.compensateFailedCardOrder({
        orderId: order.id, paymentId: order.payment!.id, providerPaymentId: cardResult.id,
        amountCents: input.cardCents, connectedAccountId: location.organization.stripeConnectedAccountId ?? undefined,
        requestId: input.requestId, locationId: input.locationId, employeeId: input.employeeId,
      });
      throw error;
    }
  }

  private async compensateFailedCardOrder(input: { orderId: string; paymentId: string; providerPaymentId: string; amountCents: number; connectedAccountId?: string; requestId: string; locationId: string; employeeId: string }) {
    const idempotencyKey = `box-office-finalize-refund:${input.requestId}`;
    const refund = await prisma.refund.upsert({
      where: { idempotencyKey },
      create: { paymentId: input.paymentId, amountCents: input.amountCents, reason: "BOX_OFFICE_INVENTORY_FINALIZATION_FAILED", scope: "TICKET", status: "CREATED", idempotencyKey },
      update: {},
    });
    if (!["CREATED", "PROCESSING"].includes(refund.status)) return;
    try {
      const result = await this.paymentProvider.refund({ connectedAccountId: input.connectedAccountId, providerPaymentId: input.providerPaymentId, amountCents: input.amountCents, reason: "requested_by_customer", idempotencyKey: refund.idempotencyKey, metadata: { refundId: refund.id, ticketOrderId: input.orderId } });
      const succeeded = result.status === "SUCCEEDED";
      await prisma.$transaction([
        prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: result.id, status: succeeded ? "SUCCEEDED" : result.status === "FAILED" ? "FAILED" : "PROCESSING" } }),
        prisma.payment.update({ where: { id: input.paymentId }, data: { status: succeeded ? "REFUNDED" : "SUCCEEDED" } }),
        prisma.ticketOrder.update({ where: { id: input.orderId }, data: { status: succeeded ? "REFUNDED" : "PAYMENT_FAILED" } }),
        prisma.auditEvent.create({ data: {
          actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
          action: succeeded ? "ticket_order.box_office_compensation_succeeded" : "ticket_order.box_office_compensation_attention_required",
          entityType: "TicketOrder", entityId: input.orderId,
          afterState: { refundId: refund.id, refundStatus: result.status, providerRefundId: result.id },
        } }),
      ]);
    } catch (error) {
      await prisma.$transaction([
        prisma.ticketOrder.update({ where: { id: input.orderId }, data: { status: "PAYMENT_FAILED" } }),
        prisma.auditEvent.create({ data: {
          actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
          action: "ticket_order.box_office_compensation_attention_required", entityType: "TicketOrder", entityId: input.orderId,
          afterState: { refundId: refund.id, refundStatus: "UNKNOWN", error: error instanceof Error ? error.message : "Unknown refund error" },
        } }),
      ]);
    }
  }

  attentionRequired(locationId: string) {
    return prisma.ticketOrder.findMany({
      where: { locationId, channel: "BOX_OFFICE", status: "PAYMENT_FAILED" },
      include: { payment: { include: { refunds: true } }, tickets: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  async setSeatBlocked(input: { inventoryId: string; locationId: string; employeeId: string; blocked: boolean; reason: string }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "showtime_seats" WHERE "id" = ${input.inventoryId} FOR UPDATE`;
      const inventory = await tx.showtimeSeat.findFirst({
        where: { id: input.inventoryId, showtime: { auditorium: { locationId: input.locationId } } },
        include: { tickets: { where: { status: { notIn: ["REFUNDED", "CANCELED"] } } }, holds: { where: { releasedAt: null, expiresAt: { gt: new Date() } } } },
      });
      if (!inventory) throw AppError.notFound("Showtime seat was not found.");
      if (input.blocked && (inventory.tickets.length || inventory.holds.length)) throw AppError.conflict("A sold or actively held seat cannot be blocked.");
      const updated = await tx.showtimeSeat.update({ where: { id: inventory.id }, data: { blockedAt: input.blocked ? new Date() : null } });
      await tx.auditEvent.create({ data: {
        actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
        action: input.blocked ? "seat.blocked" : "seat.unblocked", entityType: "ShowtimeSeat", entityId: inventory.id,
        beforeState: { blockedAt: inventory.blockedAt?.toISOString() ?? null }, afterState: { blockedAt: updated.blockedAt?.toISOString() ?? null, reason: input.reason },
      } });
      return updated;
    });
  }

  async reprint(ticketId: string, locationId: string, employeeId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, ticketOrder: { locationId }, status: { in: ["ISSUED", "ADMITTED"] } },
      include: { ticketOrder: true, showtimeSeat: { include: { seat: true, showtime: { include: { movie: true, auditorium: true } } } }, ticketType: true },
    });
    if (!ticket) throw AppError.notFound("Printable ticket was not found.");
    await prisma.auditEvent.create({ data: {
      actorType: "EMPLOYEE", actorId: employeeId, locationId, action: "ticket.reprinted",
      entityType: "Ticket", entityId: ticket.id, afterState: { orderNumber: ticket.ticketOrder.orderNumber },
    } });
    return {
      ticketId: ticket.id, credential: ticket.qrToken, orderNumber: ticket.ticketOrder.orderNumber,
      movie: ticket.showtimeSeat.showtime.movie.title, auditorium: ticket.showtimeSeat.showtime.auditorium.name,
      startsAt: ticket.showtimeSeat.showtime.startsAt, seat: ticket.showtimeSeat.seat.label, ticketType: ticket.ticketType.name,
    };
  }

  async exchangeTicket(input: { ticketId: string; locationId: string; employeeId: string; holdToken: string; holderKey: string; reason: string }) {
    return prisma.$transaction(async (tx) => {
      const original = await tx.ticket.findFirst({ where: { id: input.ticketId, ticketOrder: { locationId: input.locationId }, status: "ISSUED" }, include: { ticketOrder: true } });
      if (!original) throw AppError.notFound("Exchangeable ticket was not found.");
      const hold = await tx.seatHold.findUnique({ where: { holdToken: input.holdToken }, include: { showtimeSeat: { include: { showtime: { include: { priceTier: true, auditorium: true } } } } } });
      const now = new Date();
      if (!hold || hold.holderKey !== input.holderKey || hold.releasedAt || hold.expiresAt <= now || hold.showtimeSeat.showtime.auditorium.locationId !== input.locationId) throw AppError.conflict("The replacement seat hold is no longer valid.");
      const ids = [original.showtimeSeatId, hold.showtimeSeatId].sort();
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "showtime_seats" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
      if (await tx.ticket.findFirst({ where: { showtimeSeatId: hold.showtimeSeatId, status: { notIn: ["REFUNDED", "CANCELED"] } } })) throw AppError.conflict("The replacement seat is no longer available.");
      const replacementPrice = hold.showtimeSeat.showtime.priceTier.ticketPriceMinor;
      if (replacementPrice !== original.priceCentsPaid) throw AppError.validationFailed("MVP exchanges require a replacement seat with the same ticket price.");
      await tx.ticket.update({ where: { id: original.id }, data: { status: "CANCELED" } });
      const id = randomUUID();
      const replacement = await tx.ticket.create({ data: { id, ticketOrderId: original.ticketOrderId, showtimeSeatId: hold.showtimeSeatId, ticketTypeId: original.ticketTypeId, priceCentsPaid: original.priceCentsPaid, qrToken: createTicketCredential(id, loadEnv().QR_CREDENTIAL_SECRET) } });
      await tx.seatHold.update({ where: { id: hold.id }, data: { releasedAt: now } });
      await tx.ticketOrder.update({ where: { id: original.ticketOrderId }, data: { status: "EXCHANGED" } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket.exchanged", entityType: "Ticket", entityId: original.id, beforeState: { showtimeSeatId: original.showtimeSeatId }, afterState: { replacementTicketId: replacement.id, showtimeSeatId: replacement.showtimeSeatId, reason: input.reason } } });
      return replacement;
    });
  }

  async refundOrder(input: { orderId: string; locationId: string; employeeId: string; requestId: string; reason: string; cashDrawerId?: string }) {
    const order = await prisma.ticketOrder.findFirst({ where: { id: input.orderId, locationId: input.locationId, status: { in: ["PAID", "EXCHANGED"] } }, include: { payment: true, cashTransactions: true, location: { include: { organization: true } } } });
    if (!order) throw AppError.notFound("Refundable ticket order was not found.");
    const cashPaid = order.cashTransactions.filter((entry) => entry.type === "SALE").reduce((sum, entry) => sum + entry.amountCents, 0);
    const cardPaid = order.payment?.status === "SUCCEEDED" ? order.payment.amountCents : 0;
    const giftRedemption = await prisma.giftCardTransaction.findFirst({ where: { reference: order.id, type: "REDEMPTION" }, select: { giftCardId: true, amountCents: true } });
    const giftCardPaid = giftRedemption ? -giftRedemption.amountCents : 0;
    if (giftRedemption && cardPaid === 0) {
      if (cashPaid > 0 && !input.cashDrawerId) throw AppError.validationFailed("An open cash drawer is required for a cash refund.");
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ticket_orders" WHERE "id" = ${order.id} FOR UPDATE`;
        const lockedOrder = await tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id } });
        if (lockedOrder.status === "REFUNDED") return tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true, payment: true, cashTransactions: true } });
        if (!["PAID", "EXCHANGED"].includes(lockedOrder.status)) throw AppError.conflict("Ticket order is no longer refundable.");
        await tx.$queryRaw`SELECT "id" FROM "gift_cards" WHERE "id" = ${giftRedemption.giftCardId} FOR UPDATE`;
        const giftCard = await tx.giftCard.findUniqueOrThrow({ where: { id: giftRedemption.giftCardId } });
        const reference = `refund:${order.id}`;
        const existingRefund = await tx.giftCardTransaction.findFirst({ where: { giftCardId: giftCard.id, type: "REFUND", reference } });
        if (!existingRefund) {
          const balanceAfterCents = giftCard.balanceCents + giftCardPaid;
          await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: balanceAfterCents } });
          await tx.giftCardTransaction.create({ data: { giftCardId: giftCard.id, locationId: input.locationId, employeeId: input.employeeId, type: "REFUND", amountCents: giftCardPaid, balanceAfterCents, reference } });
        }
        if (cashPaid > 0) {
          await tx.$queryRaw`SELECT "id" FROM "cash_drawers" WHERE "id" = ${input.cashDrawerId!} FOR UPDATE`;
          const drawer = await tx.cashDrawer.findFirst({ where: { id: input.cashDrawerId, locationId: input.locationId, status: "OPEN" } });
          if (!drawer) throw AppError.conflict("The cash drawer is not open.");
          await tx.cashTransaction.upsert({ where: { idempotencyKey: `box-office-cash-refund:${input.requestId}` }, update: {}, create: { locationId: input.locationId, cashDrawerId: drawer.id, ticketOrderId: order.id, employeeId: input.employeeId, type: "REFUND", amountCents: cashPaid, reason: input.reason, idempotencyKey: `box-office-cash-refund:${input.requestId}` } });
        }
        await tx.ticket.updateMany({ where: { ticketOrderId: order.id, status: { in: ["ISSUED", "ADMITTED"] } }, data: { status: "REFUNDED" } });
        await tx.ticketOrder.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket_order.refunded", entityType: "TicketOrder", entityId: order.id, afterState: { cashCents: cashPaid, cardCents: 0, giftCardCents: giftCardPaid, reason: input.reason } } });
        return tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true, payment: true, cashTransactions: true } });
      });
    }
    if (cashPaid > 0 && !input.cashDrawerId) throw AppError.validationFailed("An open cash drawer is required for a cash refund.");
    let providerRefund: { id: string; status: "SUCCEEDED" | "PENDING" | "FAILED" } | null = null;
    let refundRow = null;
    if (cardPaid > 0) {
      if (!order.payment?.providerPaymentId) throw AppError.conflict("The card payment is missing its provider reference.");
      refundRow = await prisma.refund.upsert({ where: { idempotencyKey: `box-office-refund:${input.requestId}` }, update: {}, create: { paymentId: order.payment.id, amountCents: cardPaid, reason: input.reason, scope: "TICKET", idempotencyKey: `box-office-refund:${input.requestId}` } });
      providerRefund = await this.paymentProvider.refund({ connectedAccountId: order.location.organization.stripeConnectedAccountId ?? undefined, providerPaymentId: order.payment.providerPaymentId, amountCents: cardPaid, reason: "requested_by_customer", idempotencyKey: refundRow.idempotencyKey, metadata: { refundId: refundRow.id, ticketOrderId: order.id } });
      if (providerRefund.status === "FAILED") {
        await prisma.refund.update({ where: { id: refundRow.id }, data: { status: "FAILED", providerRefundId: providerRefund.id } });
        throw AppError.conflict("The card refund was rejected and requires staff attention.");
      }
    }
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ticket_orders" WHERE "id" = ${order.id} FOR UPDATE`;
      if (giftRedemption) {
        await tx.$queryRaw`SELECT "id" FROM "gift_cards" WHERE "id" = ${giftRedemption.giftCardId} FOR UPDATE`;
        const giftCard = await tx.giftCard.findUniqueOrThrow({ where: { id: giftRedemption.giftCardId } });
        const reference = `refund:${order.id}`;
        const existingGiftRefund = await tx.giftCardTransaction.findFirst({ where: { giftCardId: giftCard.id, type: "REFUND", reference } });
        if (!existingGiftRefund) {
          const balanceAfterCents = giftCard.balanceCents + giftCardPaid;
          await tx.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: balanceAfterCents } });
          await tx.giftCardTransaction.create({ data: { giftCardId: giftCard.id, locationId: input.locationId, employeeId: input.employeeId, type: "REFUND", amountCents: giftCardPaid, balanceAfterCents, reference } });
        }
      }
      if (cashPaid > 0) {
        await tx.$queryRaw`SELECT "id" FROM "cash_drawers" WHERE "id" = ${input.cashDrawerId!} FOR UPDATE`;
        const drawer = await tx.cashDrawer.findFirst({ where: { id: input.cashDrawerId, locationId: input.locationId, status: "OPEN" } });
        if (!drawer) throw AppError.conflict("The cash drawer is not open.");
        await tx.cashTransaction.upsert({ where: { idempotencyKey: `box-office-cash-refund:${input.requestId}` }, update: {}, create: { locationId: input.locationId, cashDrawerId: drawer.id, ticketOrderId: order.id, employeeId: input.employeeId, type: "REFUND", amountCents: cashPaid, reason: input.reason, idempotencyKey: `box-office-cash-refund:${input.requestId}` } });
      }
      await tx.ticket.updateMany({ where: { ticketOrderId: order.id, status: { in: ["ISSUED", "ADMITTED"] } }, data: { status: "REFUNDED" } });
      await tx.ticketOrder.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
      if (order.payment && refundRow && providerRefund) {
        await tx.refund.update({ where: { id: refundRow.id }, data: { providerRefundId: providerRefund.id, status: providerRefund.status === "SUCCEEDED" ? "SUCCEEDED" : "PROCESSING" } });
        await tx.payment.update({ where: { id: order.payment.id }, data: { status: providerRefund.status === "SUCCEEDED" ? "REFUNDED" : "SUCCEEDED" } });
      }
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId, action: "ticket_order.refunded", entityType: "TicketOrder", entityId: order.id, afterState: { cashCents: cashPaid, cardCents: cardPaid, giftCardCents: giftCardPaid, reason: input.reason } } });
      return tx.ticketOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true, payment: true, cashTransactions: true } });
    });
  }
  async openDrawer(input: {
    locationId: string;
    employeeId: string;
    registerId: string;
    openingBalanceCents: number;
  }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.locationId}:${input.registerId}`}))::text AS "lock"`,
      );
      const existing = await tx.cashDrawer.findFirst({
        where: { locationId: input.locationId, registerId: input.registerId, status: "OPEN" },
      });
      if (existing) throw AppError.conflict("This register already has an open cash drawer.");
      const drawer = await tx.cashDrawer.create({
        data: {
          locationId: input.locationId,
          registerId: input.registerId,
          openingBalanceCents: input.openingBalanceCents,
          openedByEmployeeId: input.employeeId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE",
          actorId: input.employeeId,
          locationId: input.locationId,
          action: "cash_drawer.opened",
          entityType: "CashDrawer",
          entityId: drawer.id,
          afterState: { registerId: drawer.registerId, openingBalanceCents: drawer.openingBalanceCents },
        },
      });
      return drawer;
    });
  }

  activeDrawer(locationId: string, registerId: string) {
    return prisma.cashDrawer.findFirst({
      where: { locationId, registerId, status: "OPEN" },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 25 } },
    });
  }

  async recordMovement(input: {
    drawerId: string;
    locationId: string;
    employeeId: string;
    type: "PAID_IN" | "PAID_OUT";
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  }) {
    const drawer = await prisma.cashDrawer.findFirst({
      where: { id: input.drawerId, locationId: input.locationId, status: "OPEN" },
    });
    if (!drawer) throw AppError.notFound("Open cash drawer not found.");
    const existing = await prisma.cashTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.cashDrawerId !== drawer.id || existing.amountCents !== input.amountCents || existing.type !== input.type) {
        throw AppError.conflict("Cash movement id was reused with different details.");
      }
      return existing;
    }
    return prisma.$transaction(async (tx) => {
      const movement = await tx.cashTransaction.create({
        data: {
          locationId: input.locationId,
          cashDrawerId: drawer.id,
          employeeId: input.employeeId,
          type: input.type,
          amountCents: input.amountCents,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
          action: input.type === "PAID_IN" ? "cash_drawer.paid_in" : "cash_drawer.paid_out",
          entityType: "CashTransaction", entityId: movement.id,
          afterState: { cashDrawerId: drawer.id, amountCents: input.amountCents, reason: input.reason },
        },
      });
      return movement;
    });
  }

  async closeDrawer(input: { drawerId: string; locationId: string; employeeId: string; closingBalanceCents: number }) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "cash_drawers" WHERE "id" = ${input.drawerId} FOR UPDATE`;
      const drawer = await tx.cashDrawer.findFirst({
        where: { id: input.drawerId, locationId: input.locationId, status: "OPEN" },
        include: { transactions: true },
      });
      if (!drawer) throw AppError.notFound("Open cash drawer not found.");
      const expectedBalanceCents = drawer.transactions.reduce((total, transaction) => {
        return total + (["SALE", "PAID_IN"].includes(transaction.type) ? transaction.amountCents : -transaction.amountCents);
      }, drawer.openingBalanceCents);
      const closedAt = new Date();
      const closed = await tx.cashDrawer.update({
        where: { id: drawer.id },
        data: { status: "CLOSED", closedByEmployeeId: input.employeeId, closedAt, closingBalanceCents: input.closingBalanceCents, expectedBalanceCents },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "EMPLOYEE", actorId: input.employeeId, locationId: input.locationId,
          action: "cash_drawer.closed", entityType: "CashDrawer", entityId: drawer.id,
          beforeState: { status: drawer.status },
          afterState: { status: "CLOSED", expectedBalanceCents, closingBalanceCents: input.closingBalanceCents, varianceCents: input.closingBalanceCents - expectedBalanceCents },
        },
      });
      return closed;
    });
  }
}
