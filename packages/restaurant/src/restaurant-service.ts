import { Prisma, PrismaClient } from "@cinema/database";

const summaryInclude = Prisma.validator<Prisma.RestaurantTabInclude>()({
  activePaymentMethod: true,
  primaryCustomer: { select: { id: true, name: true } },
  showtime: { include: { movie: true, auditorium: true } },
  seats: {
    include: {
      ticket: { include: { ticketOrder: true, ticketType: true } },
      showtimeSeat: { include: { seat: true } },
    },
    orderBy: { showtimeSeat: { seat: { label: "asc" } } },
  },
});

type SummaryTab = Prisma.RestaurantTabGetPayload<{ include: typeof summaryInclude }>;

export class RestaurantError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID",
  ) {
    super(message);
  }
}

export class RestaurantService {
  constructor(private readonly prisma: PrismaClient) {}

  async openSeatLinkedTabs(input: {
    ticketOrderId: string;
    locationId: string;
    actorId: string;
    mode: "SHARED" | "SEPARATE";
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.ticketOrder.findFirst({
        where: {
          id: input.ticketOrderId,
          locationId: input.locationId,
          status: "PAID",
        },
        include: {
          tickets: {
            where: { status: { notIn: ["REFUNDED", "CANCELED"] } },
            include: { showtimeSeat: true },
            orderBy: { showtimeSeatId: "asc" },
          },
          consents: {
            where: { type: "DINING_AUTO_SETTLEMENT", granted: true },
            include: { paymentMethodReference: true },
            take: 1,
          },
        },
      });
      if (!order?.tickets.length) {
        throw new RestaurantError("Paid ticket order was not found.", "NOT_FOUND");
      }
      const showtimeIds = new Set(order.tickets.map((ticket) => ticket.showtimeSeat.showtimeId));
      if (showtimeIds.size !== 1) {
        throw new RestaurantError("A seat-linked tab must belong to one showtime.", "INVALID");
      }

      const seatIds = order.tickets.map((ticket) => ticket.showtimeSeatId).sort();
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "showtime_seats" WHERE "id" IN (${Prisma.join(seatIds)}) ORDER BY "id" FOR UPDATE`,
      );
      const seats = await tx.showtimeSeat.findMany({
        where: { id: { in: seatIds } },
        select: { id: true, currentTabSeatId: true },
      });
      if (seats.some((seat) => seat.currentTabSeatId)) {
        const existing = await this.summariesForOrder(tx, order.id);
        if (existing.length) {
          const existingMode =
            existing.length === 1 && existing[0]!.seats.length === order.tickets.length
              ? "SHARED"
              : "SEPARATE";
          if (existingMode !== input.mode) {
            throw new RestaurantError(
              `Tabs for this ticket order were already opened in ${existingMode.toLowerCase()} mode.`,
              "CONFLICT",
            );
          }
          return existing;
        }
        throw new RestaurantError("One or more seats already belong to an open tab.", "CONFLICT");
      }

      const consent = order.consents[0];
      const paymentMethod =
        consent?.paymentMethodReference?.active ? consent.paymentMethodReference : null;
      const groups =
        input.mode === "SHARED"
          ? [order.tickets]
          : order.tickets.map((ticket) => [ticket]);

      for (const tickets of groups) {
        const tab = await tx.restaurantTab.create({
          data: {
            locationId: order.locationId,
            primaryCustomerId: order.customerId,
            tabType: "SEAT_LINKED",
            showtimeId: tickets[0]!.showtimeSeat.showtimeId,
            status: paymentMethod ? "PREAUTHORIZED" : "OPEN",
            autoSettleAuthorized: Boolean(paymentMethod),
            activePaymentMethodId: paymentMethod?.id,
            activePaymentMethodSetAt: paymentMethod ? new Date() : null,
          },
        });
        for (const ticket of tickets) {
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
        await tx.auditEvent.create({
          data: {
            actorType: "EMPLOYEE",
            actorId: input.actorId,
            action: "restaurant_tab.opened",
            entityType: "RestaurantTab",
            entityId: tab.id,
            locationId: order.locationId,
            afterState: {
              mode: input.mode,
              ticketOrderId: order.id,
              showtimeSeatIds: tickets.map((ticket) => ticket.showtimeSeatId),
              autoSettleAuthorized: Boolean(paymentMethod),
            },
          },
        });
      }
      return this.summariesForOrder(tx, order.id);
    });
  }

  async getSummary(input: { tabId: string; locationId: string }) {
    const tab = await this.prisma.restaurantTab.findFirst({
      where: { id: input.tabId, locationId: input.locationId },
      include: summaryInclude,
    });
    if (!tab) throw new RestaurantError("Restaurant tab was not found.", "NOT_FOUND");
    return this.presentSummary(tab);
  }

  private summariesForOrder(tx: Prisma.TransactionClient, ticketOrderId: string) {
    return tx.restaurantTab
      .findMany({
        where: { seats: { some: { ticket: { ticketOrderId } } } },
        include: summaryInclude,
        orderBy: { openedAt: "asc" },
      })
      .then((tabs) => tabs.map((tab) => this.presentSummary(tab)));
  }

  private presentSummary(tab: SummaryTab) {
    return {
      id: tab.id,
      status: tab.status,
      tabType: tab.tabType,
      autoSettleAuthorized: tab.autoSettleAuthorized,
      customer: tab.primaryCustomer,
      showtime: tab.showtime
        ? {
            id: tab.showtime.id,
            movie: tab.showtime.movie.title,
            auditorium: tab.showtime.auditorium.name,
            startsAt: tab.showtime.startsAt.toISOString(),
          }
        : null,
      paymentMethod: tab.activePaymentMethod
        ? {
            brand: tab.activePaymentMethod.brand,
            last4: tab.activePaymentMethod.last4,
          }
        : null,
      seats: tab.seats.map((seat) => ({
        ticketId: seat.ticketId,
        ticketOrderId: seat.ticket.ticketOrderId,
        showtimeSeatId: seat.showtimeSeatId,
        seat: seat.showtimeSeat.seat.label,
        ticketType: seat.ticket.ticketType.name,
      })),
    };
  }
}
