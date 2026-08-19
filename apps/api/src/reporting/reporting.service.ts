import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, prisma } from "@cinema/database";
import { AppError } from "../common/app-error";

export interface ReportRange { from: Date; to: Date }

@Injectable()
export class ReportingService {
  async audienceOrigins(locationId: string, range: ReportRange) {
    const orders = await prisma.ticketOrder.findMany({
      where: { locationId, createdAt: { gte: range.from, lt: range.to }, status: { in: ["PAID", "EXCHANGED"] } },
      select: { zipCode: true, _count: { select: { tickets: true } } },
    });
    return { range, ...this.summarizeAudienceOrigins(orders) };
  }

  summarizeAudienceOrigins(orders: Array<{ zipCode: string | null; _count: { tickets: number } }>) {
    const grouped = new Map<string, { zipCode: string; orders: number; tickets: number }>();
    let ordersWithZip = 0;
    let ticketsWithZip = 0;
    for (const order of orders) {
      const zipCode = order.zipCode?.trim().match(/^(\d{5})(?:-\d{4})?$/)?.[1];
      if (!zipCode) continue;
      ordersWithZip += 1;
      ticketsWithZip += order._count.tickets;
      const row = grouped.get(zipCode) ?? { zipCode, orders: 0, tickets: 0 };
      row.orders += 1;
      row.tickets += order._count.tickets;
      grouped.set(zipCode, row);
    }
    return {
      totals: { completedOrders: orders.length, ordersWithZip, ticketsWithZip, coveragePercent: orders.length ? Math.round((ordersWithZip / orders.length) * 100) : 0 },
      origins: [...grouped.values()]
        .map((row) => ({ ...row, sharePercent: ticketsWithZip ? Math.round((row.tickets / ticketsWithZip) * 1000) / 10 : 0 }))
        .sort((a, b) => b.tickets - a.tickets || b.orders - a.orders || a.zipCode.localeCompare(b.zipCode)),
    };
  }

  async expenses(locationId: string, range: ReportRange) {
    const rows = await prisma.expense.findMany({
      where: { locationId, incurredAt: { gte: range.from, lt: range.to } },
      orderBy: [{ incurredAt: "desc" }, { createdAt: "desc" }],
    });
    const byCategory = rows.reduce<Record<string, number>>((totals, expense) => {
      totals[expense.category] = (totals[expense.category] ?? 0) + expense.amountCents;
      return totals;
    }, {});
    return { range, totals: { totalExpenseCents: rows.reduce((sum, expense) => sum + expense.amountCents, 0), count: rows.length, byCategory }, rows };
  }

  async createExpense(locationId: string, employeeId: string, input: { category: Prisma.ExpenseCreateInput["category"]; vendor?: string; description: string; amountCents: number; incurredAt: Date; notes?: string }, suppliedRequestId?: string) {
    const requestId = suppliedRequestId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const normalized = { locationId, category: input.category, vendor: input.vendor || null, description: input.description, amountCents: input.amountCents, incurredAt: input.incurredAt.toISOString(), notes: input.notes || null };
    const requestFingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId, action: "expense.created", afterState: { path: ["requestId"], equals: requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The expense idempotency key was already used with different details.");
        const expense = await tx.expense.findUnique({ where: { id: replay.entityId } });
        if (!expense) throw AppError.conflict("The original expense entry is no longer available.");
        return expense;
      }
      const expense = await tx.expense.create({ data: { locationId, ...input, vendor: input.vendor || null, notes: input.notes || null } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId, action: "expense.created", entityType: "Expense", entityId: expense.id, afterState: { requestId, requestFingerprint } } });
      return expense;
    });
  }

  async deleteExpense(locationId: string, expenseId: string) {
    const deleted = await prisma.expense.deleteMany({ where: { id: expenseId, locationId } });
    if (!deleted.count) throw AppError.notFound("Expense entry not found.");
    return { deleted: true };
  }

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
    const [location, ticketOrders, tabs, concessionItems] = await Promise.all([
      prisma.location.findUniqueOrThrow({ where: { id: locationId }, select: { timezone: true } }),
      prisma.ticketOrder.findMany({
        where: { locationId, createdAt: { gte: range.from, lt: range.to }, status: { in: ["PAID", "EXCHANGED", "REFUNDED"] } },
        include: { placedByEmployee: { select: { id: true, name: true } }, tickets: { include: { ticketType: true, showtimeSeat: { include: { showtime: { include: { movie: true } } } } } } },
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, closedAt: { gte: range.from, lt: range.to }, status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } },
        include: { showtime: { include: { movie: true } }, seats: true, payments: { include: { refunds: { where: { status: "SUCCEEDED" } } } } },
      }),
      prisma.restaurantOrderItem.findMany({
        where: {
          restaurantOrder: {
            restaurantTab: { locationId },
            placedAt: { gte: range.from, lt: range.to },
            status: { in: ["SENT", "IN_PROGRESS", "PARTIALLY_DELIVERED", "DELIVERED"] },
          },
          status: "SENT",
        },
        include: { menuItem: { select: { id: true, name: true } } },
      }),
    ]);

    const movies = new Map<string, { movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>();
    const showtimes = new Map<string, { showtimeId: string; movieId: string; title: string; startsAt: Date; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>();
    const admissionTypes = new Map<string, { ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>();
    const salesChannels = new Map<string, { channel: string; ticketsSold: number; ticketRevenueCents: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>();
    const salesOperators = new Map<string, { employeeId: string; employeeName: string; ticketsSold: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>();
    const concessionSales = new Map<string, { menuItemId: string; name: string; unitsSold: number; salesCents: number }>();
    const dailyPerformance = new Map<string, { date: string; ticketsSold: number; ticketCollectedCents: number; fnbRevenueCents: number }>();
    const businessDate = (value: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: location.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
      return `${part("year")}-${part("month")}-${part("day")}`;
    };
    const ensureDay = (value: Date) => {
      const date = businessDate(value);
      let row = dailyPerformance.get(date);
      if (!row) { row = { date, ticketsSold: 0, ticketCollectedCents: 0, fnbRevenueCents: 0 }; dailyPerformance.set(date, row); }
      return row;
    };
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
      const salesChannel = salesChannels.get(order.channel) ?? { channel: order.channel, ticketsSold: 0, ticketRevenueCents: 0, grossCollectedCents: 0, refundedCents: 0, netCollectedCents: 0 };
      salesChannel.grossCollectedCents += order.totalCents;
      const salesOperator = order.placedByEmployee
        ? salesOperators.get(order.placedByEmployee.id) ?? { employeeId: order.placedByEmployee.id, employeeName: order.placedByEmployee.name, ticketsSold: 0, grossCollectedCents: 0, refundedCents: 0, netCollectedCents: 0 }
        : null;
      if (salesOperator) salesOperator.grossCollectedCents += order.totalCents;
      if (order.status === "REFUNDED") {
        ticketRefundedCents += order.totalCents;
        salesChannel.refundedCents += order.totalCents;
        if (salesOperator) {
          salesOperator.refundedCents += order.totalCents;
          salesOperators.set(salesOperator.employeeId, salesOperator);
        }
        salesChannels.set(order.channel, salesChannel);
        continue;
      }
      salesChannel.netCollectedCents += order.totalCents;
      if (salesOperator) salesOperator.netCollectedCents += order.totalCents;
      if (!order.tickets.length) {
        if (salesOperator) salesOperators.set(salesOperator.employeeId, salesOperator);
        salesChannels.set(order.channel, salesChannel);
        continue;
      }
      ticketFeesCents += order.feesCents;
      ticketTaxCents += order.taxCents;
      ticketCollectedCents += order.totalCents;
      const orderDay = ensureDay(order.createdAt);
      orderDay.ticketsSold += order.tickets.length;
      orderDay.ticketCollectedCents += order.totalCents;
      salesChannel.ticketsSold += order.tickets.length;
      if (salesOperator) salesOperator.ticketsSold += order.tickets.length;
      order.tickets.forEach((ticket) => {
        const showtime = ticket.showtimeSeat.showtime;
        const revenue = ticket.priceCentsPaid;
        ticketRevenueCents += revenue;
        const admissionType = admissionTypes.get(ticket.ticketTypeId) ?? { ticketTypeId: ticket.ticketTypeId, name: ticket.ticketType.name, ticketsSold: 0, ticketRevenueCents: 0 };
        admissionType.ticketsSold += 1;
        admissionType.ticketRevenueCents += revenue;
        admissionTypes.set(ticket.ticketTypeId, admissionType);
        salesChannel.ticketRevenueCents += revenue;
        const movie = ensureMovie(showtime.movieId, showtime.movie.title);
        movie.ticketRevenueCents += revenue; movie.ticketsSold += 1;
        const showing = ensureShowtime(showtime.id, showtime.movieId, showtime.movie.title, showtime.startsAt);
        showing.ticketRevenueCents += revenue; showing.ticketsSold += 1;
      });
      salesChannels.set(order.channel, salesChannel);
      if (salesOperator) salesOperators.set(salesOperator.employeeId, salesOperator);
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
      if (tab.closedAt) ensureDay(tab.closedAt).fnbRevenueCents += revenue;
      if (tab.showtime) {
        ensureMovie(tab.showtime.movieId, tab.showtime.movie.title).fnbRevenueCents += revenue;
        ensureShowtime(tab.showtime.id, tab.showtime.movieId, tab.showtime.movie.title, tab.showtime.startsAt).fnbRevenueCents += revenue;
      }
    }

    for (const item of concessionItems) {
      const sale = concessionSales.get(item.menuItemId) ?? { menuItemId: item.menuItem.id, name: item.menuItem.name, unitsSold: 0, salesCents: 0 };
      sale.unitsSold += item.quantity;
      sale.salesCents += (item.unitPriceCentsSnapshot + item.modifierTotalCents) * item.quantity;
      concessionSales.set(item.menuItemId, sale);
    }

    const ticketsSold = ticketOrders.filter((order) => order.status !== "REFUNDED").reduce((sum, order) => sum + order.tickets.length, 0);
    const combinedRevenueCents = ticketCollectedCents + fnbRevenueCents;
    return {
      range, totals: { grossRevenueCents: ticketCollectedCents + ticketRefundedCents + fnbRevenueCents + fnbRefundedCents, refundedCents: ticketRefundedCents + fnbRefundedCents, ticketRefundedCents, fnbRefundedCents, ticketRevenueCents, ticketFeesCents, ticketTaxCents, ticketCollectedCents, fnbRevenueCents, combinedRevenueCents, ticketsSold, fnbOrders: fnbOrderCount, averageFnbSpendPerOrderCents: fnbOrderCount ? Math.round(fnbRevenueCents / fnbOrderCount) : 0, averageFnbSpendPerSeatCents: fnbSeatCount ? Math.round(fnbRevenueCents / fnbSeatCount) : 0, averageTotalSpendPerPatronCents: ticketsSold ? Math.round(combinedRevenueCents / ticketsSold) : 0, concessionAttachRatePercent: ticketsSold ? Math.min(100, Math.round((fnbSeatCount / ticketsSold) * 1000) / 10) : 0 },
      movies: [...movies.values()].sort((a, b) => a.title.localeCompare(b.title)),
      showtimes: [...showtimes.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      admissionTypes: [...admissionTypes.values()].sort((a, b) => b.ticketsSold - a.ticketsSold || a.name.localeCompare(b.name)),
      salesChannels: [...salesChannels.values()].sort((a, b) => b.ticketsSold - a.ticketsSold || a.channel.localeCompare(b.channel)),
      salesOperators: [...salesOperators.values()].sort((a, b) => b.netCollectedCents - a.netCollectedCents || a.employeeName.localeCompare(b.employeeName)),
      concessionTopSellers: [...concessionSales.values()].sort((a, b) => b.unitsSold - a.unitsSold || b.salesCents - a.salesCents || a.name.localeCompare(b.name)),
      dailyPerformance: [...dailyPerformance.values()].sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({ ...day, combinedRevenueCents: day.ticketCollectedCents + day.fnbRevenueCents, averageTotalSpendPerPatronCents: day.ticketsSold ? Math.round((day.ticketCollectedCents + day.fnbRevenueCents) / day.ticketsSold) : 0 })),
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
      ["Average total spend per patron (cents)", report.totals.averageTotalSpendPerPatronCents],
      ["Concession attach rate (percent)", report.totals.concessionAttachRatePercent],
    ];
    return [
      row(["Report from", report.range.from.toISOString()]), row(["Report to", report.range.to.toISOString()]),
      row(["Summary metric", "Value"]), ...totals.map(row), "",
      row(["Movie", "Tickets sold", "Ticket face value (cents)", "F&B revenue (cents)"]),
      ...report.movies.map((movie) => row([movie.title, movie.ticketsSold, movie.ticketRevenueCents, movie.fnbRevenueCents])), "",
      row(["Showtime", "Starts at", "Tickets sold", "Ticket face value (cents)", "F&B revenue (cents)"]),
      ...report.showtimes.map((showtime) => row([showtime.title, showtime.startsAt.toISOString(), showtime.ticketsSold, showtime.ticketRevenueCents, showtime.fnbRevenueCents])), "",
      row(["Admission type", "Tickets sold", "Ticket face value (cents)"]),
      ...report.admissionTypes.map((ticketType) => row([ticketType.name, ticketType.ticketsSold, ticketType.ticketRevenueCents])), "",
      row(["Sales channel", "Tickets sold", "Ticket face value (cents)", "Gross collected (cents)", "Refunds (cents)", "Net collected (cents)"]),
      ...report.salesChannels.map((channel) => row([channel.channel, channel.ticketsSold, channel.ticketRevenueCents, channel.grossCollectedCents, channel.refundedCents, channel.netCollectedCents])),
      "", row(["Box-office operator", "Tickets sold", "Gross collected (cents)", "Refunds (cents)", "Net collected (cents)"]),
      ...report.salesOperators.map((operator) => row([operator.employeeName, operator.ticketsSold, operator.grossCollectedCents, operator.refundedCents, operator.netCollectedCents])),
      "", row(["Concession item", "Units sold", "Sales value (cents)"]),
      ...report.concessionTopSellers.map((item) => row([item.name, item.unitsSold, item.salesCents])),
      "", row(["Business date", "Tickets sold", "Ticket collected (cents)", "F&B revenue (cents)", "Net revenue (cents)", "Average total spend per patron (cents)"]),
      ...report.dailyPerformance.map((day) => row([day.date, day.ticketsSold, day.ticketCollectedCents, day.fnbRevenueCents, day.combinedRevenueCents, day.averageTotalSpendPerPatronCents])),
    ].join("\n");
  }

  distributorBoxOfficeCsv(report: Awaited<ReturnType<ReportingService["revenue"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    return [
      row(["Distributor box office report"]),
      row(["Report from", report.range.from.toISOString()]),
      row(["Report to", report.range.to.toISOString()]),
      "",
      row(["Film summary"]),
      row(["Film", "Paid admissions", "Ticket face value (cents)"]),
      ...report.movies.map((movie) => row([movie.title, movie.ticketsSold, movie.ticketRevenueCents])),
      "",
      row(["Showtime detail"]),
      row(["Film", "Showtime", "Paid admissions", "Ticket face value (cents)"]),
      ...report.showtimes.map((showtime) => row([showtime.title, showtime.startsAt.toISOString(), showtime.ticketsSold, showtime.ticketRevenueCents])),
    ].join("\n");
  }

  laborCsv(rows: Awaited<ReturnType<ReportingService["labor"]>>["rows"]) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return ["Employee,Roles,Clock in,Clock out,Break minutes,Worked minutes", ...rows.map((row) => [row.employeeName, row.roles.join("; "), row.clockInAt.toISOString(), row.clockOutAt?.toISOString() ?? "", row.breakMinutes, row.workedMinutes].map(quote).join(","))].join("\n");
  }

  expensesCsv(report: Awaited<ReturnType<ReportingService["expenses"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return [
      ["Date", "Category", "Vendor", "Description", "Amount (cents)", "Notes"].map(quote).join(","),
      ...report.rows.map((expense) => [expense.incurredAt.toISOString(), expense.category, expense.vendor, expense.description, expense.amountCents, expense.notes].map(quote).join(",")),
    ].join("\n");
  }
}
