import { Prisma, TicketOrderStatus } from "@cinema/database";

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
