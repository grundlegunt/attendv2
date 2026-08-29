import { Prisma, TicketOrderStatus } from "@cinema/database";

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

/** Restores cash and gift-card portions that were deliberately deferred while
 * a mixed-tender card refund was pending at the processor. */
export async function settleDeferredBoxOfficeTenderRefunds(
  tx: Prisma.TransactionClient,
  ticketOrderId: string,
  refundId: string,
): Promise<void> {
  const pending = await tx.auditEvent.findFirst({
    where: {
      entityType: "Refund",
      entityId: refundId,
      action: "ticket_order.refund_tender_plan",
    },
    orderBy: { occurredAt: "desc" },
    select: { actorId: true, locationId: true, afterState: true },
  });
  const plan = record(pending?.afterState ?? null);
  if (!pending?.actorId || plan?.ticketOrderId !== ticketOrderId) return;

  const requestId = typeof plan.requestId === "string" ? plan.requestId : null;
  const reason = typeof plan.reason === "string" ? plan.reason : null;
  const cashDrawerId = typeof plan.cashDrawerId === "string" ? plan.cashDrawerId : null;
  const giftCardId = typeof plan.giftCardId === "string" ? plan.giftCardId : null;
  const cashCents = typeof plan.cashCents === "number" ? plan.cashCents : 0;
  const giftCardCents = typeof plan.giftCardCents === "number" ? plan.giftCardCents : 0;
  if (!requestId || !reason) return;

  if (giftCardId && giftCardCents > 0) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "gift_cards" WHERE "id" = ${giftCardId} FOR UPDATE`);
    const reference = `refund:${ticketOrderId}:${requestId}`;
    const existing = await tx.giftCardTransaction.findFirst({
      where: { giftCardId, type: "REFUND", reference },
    });
    if (!existing) {
      const giftCard = await tx.giftCard.findUniqueOrThrow({ where: { id: giftCardId } });
      const balanceAfterCents = giftCard.balanceCents + giftCardCents;
      await tx.giftCard.update({ where: { id: giftCardId }, data: { balanceCents: balanceAfterCents } });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId,
          locationId: pending.locationId!,
          employeeId: pending.actorId,
          type: "REFUND",
          amountCents: giftCardCents,
          balanceAfterCents,
          reference,
        },
      });
    }
  }

  if (cashDrawerId && cashCents > 0) {
    await tx.cashTransaction.upsert({
      where: { idempotencyKey: `box-office-cash-refund:${requestId}` },
      update: {},
      create: {
        locationId: pending.locationId!,
        cashDrawerId,
        ticketOrderId,
        employeeId: pending.actorId,
        type: "REFUND",
        amountCents: cashCents,
        reason,
        idempotencyKey: `box-office-cash-refund:${requestId}`,
      },
    });
  }
}

/**
 * Applies the local consequences of a confirmed full ticket-order refund.
 *
 * Payment providers may settle refunds asynchronously, so this transition
 * must be shared by the initiating request, webhook handling, and the
 * reconciliation sweep. Until this runs, sold seats and order-ahead kitchen
 * work intentionally remain active.
 */
export async function finalizeConfirmedTicketOrderRefund(
  tx: Prisma.TransactionClient,
  ticketOrderId: string,
): Promise<boolean> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "ticket_orders" WHERE "id" = ${ticketOrderId} FOR UPDATE`,
  );
  const order = await tx.ticketOrder.findUnique({
    where: { id: ticketOrderId },
    select: { status: true },
  });
  const refundableStatuses = new Set<TicketOrderStatus>([
    TicketOrderStatus.PAID,
    TicketOrderStatus.EXCHANGED,
    TicketOrderStatus.PARTIALLY_REFUNDED,
  ]);
  if (!order || !refundableStatuses.has(order.status)) return false;

  await tx.ticket.updateMany({
    where: { ticketOrderId, status: { in: ["ISSUED", "ADMITTED"] } },
    data: { status: "REFUNDED" },
  });

  const restaurantOrders = await tx.restaurantOrder.findMany({
    where: {
      ticketOrderId,
      source: "ONLINE_ORDER_AHEAD",
      status: { notIn: ["CANCELED", "DELIVERED"] },
    },
    select: { id: true },
  });
  const restaurantOrderIds = restaurantOrders.map(({ id }) => id);
  if (restaurantOrderIds.length > 0) {
    await tx.fulfillmentTicket.updateMany({
      where: {
        restaurantOrderId: { in: restaurantOrderIds },
        status: { notIn: ["CANCELED", "VOIDED", "DELIVERED"] },
      },
      data: { status: "CANCELED" },
    });
    await tx.restaurantOrderItem.updateMany({
      where: {
        restaurantOrderId: { in: restaurantOrderIds },
        status: { in: ["DRAFT", "SENT"] },
      },
      data: { status: "VOIDED" },
    });
    await tx.restaurantOrder.updateMany({
      where: { id: { in: restaurantOrderIds } },
      data: { status: "CANCELED" },
    });
  }

  await tx.ticketOrder.update({
    where: { id: ticketOrderId },
    data: { status: TicketOrderStatus.REFUNDED },
  });
  return true;
}
