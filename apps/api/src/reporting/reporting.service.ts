import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@cinema/database";

export interface ReportRange { from: Date; to: Date }

@Injectable()
export class ReportingService {
  async customerRecency(locationId: string, inactiveSince: Date, limit: number) {
    const completedOrder: Prisma.TicketOrderWhereInput = { locationId, status: { in: ["PAID", "EXCHANGED"] } };
    const where: Prisma.CustomerWhereInput = { ticketOrders: { some: completedOrder, none: { ...completedOrder, createdAt: { gt: inactiveSince } } } };
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({ where, select: { id: true, name: true, email: true, ticketOrders: { where: completedOrder, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, orderNumber: true, totalCents: true } } }, orderBy: { name: "asc" }, take: limit }),
    ]);
    return { inactiveSince, total, preview: customers.map(({ ticketOrders, ...customer }) => ({ ...customer, name: customer.name ?? "Guest", email: customer.email ?? "No email", lastPurchaseAt: ticketOrders[0]!.createdAt, lastOrderNumber: ticketOrders[0]!.orderNumber, lastOrderTotalCents: ticketOrders[0]!.totalCents })) };
  }

  async revenue(locationId: string, range: ReportRange) {
    const [ticketOrders, tabs] = await Promise.all([
      prisma.ticketOrder.findMany({
        where: { locationId, createdAt: { gte: range.from, lt: range.to }, status: { in: ["PAID", "EXCHANGED", "REFUNDED"] } },
        include: { tickets: { include: { showtimeSeat: { include: { showtime: { include: { movie: true } } } } } } },
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, closedAt: { gte: range.from, lt: range.to }, status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } },
        include: { showtime: { include: { movie: true } }, seats: true, payments: { include: { refunds: { where: { status: "SUCCEEDED" } } } } },
      }),
    ]);

    const movies = new Map<string, { movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>();
    const showtimes = new Map<string, { showtimeId: string; movieId: string; title: string; startsAt: Date; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>();
    const ensureMovie = (movieId: string, title: string) => {
      let row = movies.get(movieId);
      if (!row) { row = { movieId, title, ticketRevenueCents: 0, ticketsSold: 0, fnbRevenueCents: 0 }; movies.set(movieId, row); }
      return row;
    };
    const ensureShowtime = (showtimeId: string, movieId: string, title: string, startsAt: Date) => {
      let row = showtimes.get(showtimeId);
      if (!row) { row = { showtimeId, movieId, title, startsAt, ticketRevenueCents: 0, ticketsSold: 0, fnbRevenueCents: 0 }; showtimes.set(showtimeId, row); }
      return row;
    };

    let ticketRevenueCents = 0;
    let ticketFeesCents = 0;
    let ticketTaxCents = 0;
    let ticketCollectedCents = 0;
    let ticketRefundedCents = 0;
    for (const order of ticketOrders) {
      if (order.status === "REFUNDED") { ticketRefundedCents += order.totalCents; continue; }
      if (!order.tickets.length) continue;
      ticketFeesCents += order.feesCents;
      ticketTaxCents += order.taxCents;
      ticketCollectedCents += order.totalCents;
      order.tickets.forEach((ticket) => {
        const showtime = ticket.showtimeSeat.showtime;
        const revenue = ticket.priceCentsPaid;
        ticketRevenueCents += revenue;
        const movie = ensureMovie(showtime.movieId, showtime.movie.title);
        movie.ticketRevenueCents += revenue; movie.ticketsSold += 1;
        const showing = ensureShowtime(showtime.id, showtime.movieId, showtime.movie.title, showtime.startsAt);
        showing.ticketRevenueCents += revenue; showing.ticketsSold += 1;
      });
    }

    let fnbRevenueCents = 0;
    let fnbRefundedCents = 0;
    let fnbSeatCount = 0;
    let fnbOrderCount = 0;
    for (const tab of tabs) {
      const gross = tab.totalCents ?? 0;
      const recordedRefunds = tab.payments.reduce((sum, payment) => sum + payment.refunds.reduce((paymentSum, refund) => paymentSum + refund.amountCents, 0), 0);
      const refunded = tab.status === "REFUNDED" && recordedRefunds === 0 ? gross : Math.min(gross, recordedRefunds);
      const revenue = gross - refunded;
      fnbRefundedCents += refunded;
      if (!revenue) continue;
      fnbRevenueCents += revenue;
      fnbSeatCount += tab.seats.length;
      fnbOrderCount += 1;
      if (tab.showtime) {
        ensureMovie(tab.showtime.movieId, tab.showtime.movie.title).fnbRevenueCents += revenue;
        ensureShowtime(tab.showtime.id, tab.showtime.movieId, tab.showtime.movie.title, tab.showtime.startsAt).fnbRevenueCents += revenue;
      }
    }

    return {
      range, totals: { grossRevenueCents: ticketCollectedCents + ticketRefundedCents + fnbRevenueCents + fnbRefundedCents, refundedCents: ticketRefundedCents + fnbRefundedCents, ticketRefundedCents, fnbRefundedCents, ticketRevenueCents, ticketFeesCents, ticketTaxCents, ticketCollectedCents, fnbRevenueCents, combinedRevenueCents: ticketCollectedCents + fnbRevenueCents, ticketsSold: ticketOrders.filter((order) => order.status !== "REFUNDED").reduce((sum, order) => sum + order.tickets.length, 0), fnbOrders: fnbOrderCount, averageFnbSpendPerOrderCents: fnbOrderCount ? Math.round(fnbRevenueCents / fnbOrderCount) : 0, averageFnbSpendPerSeatCents: fnbSeatCount ? Math.round(fnbRevenueCents / fnbSeatCount) : 0 },
      movies: [...movies.values()].sort((a, b) => a.title.localeCompare(b.title)),
      showtimes: [...showtimes.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    };
  }

  async labor(locationId: string, range: ReportRange) {
    const shifts = await prisma.shift.findMany({
      where: { locationId, clockInAt: { lt: range.to }, OR: [{ clockOutAt: null }, { clockOutAt: { gte: range.from } }] },
      include: { employee: { include: { employeeRoles: { where: { locationId }, include: { role: true } } } } },
      orderBy: [{ employee: { name: "asc" } }, { clockInAt: "asc" }],
    });
    const rows = shifts.map((shift) => {
      const effectiveStart = shift.clockInAt < range.from ? range.from : shift.clockInAt;
      const effectiveEnd = !shift.clockOutAt || shift.clockOutAt > range.to ? range.to : shift.clockOutAt;
      const breakStart = shift.breakStartAt && shift.breakStartAt > effectiveStart ? shift.breakStartAt : effectiveStart;
      const breakEnd = shift.breakEndAt && shift.breakEndAt < effectiveEnd ? shift.breakEndAt : effectiveEnd;
      const breakMinutes = shift.breakStartAt && shift.breakEndAt ? Math.max(0, Math.round((breakEnd.getTime() - breakStart.getTime()) / 60_000)) : 0;
      const workedMinutes = Math.max(0, Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000) - breakMinutes);
      return { shiftId: shift.id, employeeId: shift.employeeId, employeeName: shift.employee.name, roles: shift.employee.employeeRoles.map((entry) => entry.role.name), clockInAt: shift.clockInAt, clockOutAt: shift.clockOutAt, breakStartAt: shift.breakStartAt, breakEndAt: shift.breakEndAt, breakMinutes, workedMinutes };
    });
    return { range, rows, totalMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0) };
  }

  revenueCsv(report: Awaited<ReturnType<ReportingService["revenue"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    const totals = [
      ["Gross revenue (cents)", report.totals.grossRevenueCents], ["Refunds (cents)", report.totals.refundedCents],
      ["Net revenue (cents)", report.totals.combinedRevenueCents], ["Ticket face value (cents)", report.totals.ticketRevenueCents],
      ["Ticket fees (cents)", report.totals.ticketFeesCents], ["Ticket tax (cents)", report.totals.ticketTaxCents],
      ["Ticket total collected (cents)", report.totals.ticketCollectedCents],
      ["F&B revenue (cents)", report.totals.fnbRevenueCents], ["Tickets sold", report.totals.ticketsSold],
      ["F&B orders", report.totals.fnbOrders], ["Average F&B per order (cents)", report.totals.averageFnbSpendPerOrderCents],
      ["Average F&B per occupied seat (cents)", report.totals.averageFnbSpendPerSeatCents],
    ];
    return [
      row(["Report from", report.range.from.toISOString()]), row(["Report to", report.range.to.toISOString()]),
      row(["Summary metric", "Value"]), ...totals.map(row), "",
      row(["Movie", "Tickets sold", "Ticket face value (cents)", "F&B revenue (cents)"]),
      ...report.movies.map((movie) => row([movie.title, movie.ticketsSold, movie.ticketRevenueCents, movie.fnbRevenueCents])), "",
      row(["Showtime", "Starts at", "Tickets sold", "Ticket face value (cents)", "F&B revenue (cents)"]),
      ...report.showtimes.map((showtime) => row([showtime.title, showtime.startsAt.toISOString(), showtime.ticketsSold, showtime.ticketRevenueCents, showtime.fnbRevenueCents])),
    ].join("\n");
  }

  laborCsv(rows: Awaited<ReturnType<ReportingService["labor"]>>["rows"]) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return ["Employee,Roles,Clock in,Clock out,Break minutes,Worked minutes", ...rows.map((row) => [row.employeeName, row.roles.join("; "), row.clockInAt.toISOString(), row.clockOutAt?.toISOString() ?? "", row.breakMinutes, row.workedMinutes].map(quote).join(","))].join("\n");
  }
}
