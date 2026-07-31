import { Injectable } from "@nestjs/common";
import { prisma } from "@cinema/database";

export interface ReportRange { from: Date; to: Date }

@Injectable()
export class ReportingService {
  async revenue(locationId: string, range: ReportRange) {
    const [ticketOrders, tabs] = await Promise.all([
      prisma.ticketOrder.findMany({
        where: { locationId, createdAt: { gte: range.from, lt: range.to }, status: { in: ["PAID", "EXCHANGED"] } },
        include: { tickets: { where: { status: { in: ["ISSUED", "ADMITTED"] } }, include: { showtimeSeat: { include: { showtime: { include: { movie: true } } } } } } },
      }),
      prisma.restaurantTab.findMany({
        where: { locationId, closedAt: { gte: range.from, lt: range.to }, status: "CLOSED" },
        include: { showtime: { include: { movie: true } }, seats: true },
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
    for (const order of ticketOrders) {
      if (!order.tickets.length) continue;
      const allocated = Math.floor(order.totalCents / order.tickets.length);
      order.tickets.forEach((ticket, index) => {
        const showtime = ticket.showtimeSeat.showtime;
        const revenue = index === order.tickets.length - 1 ? order.totalCents - allocated * index : allocated;
        ticketRevenueCents += revenue;
        const movie = ensureMovie(showtime.movieId, showtime.movie.title);
        movie.ticketRevenueCents += revenue; movie.ticketsSold += 1;
        const showing = ensureShowtime(showtime.id, showtime.movieId, showtime.movie.title, showtime.startsAt);
        showing.ticketRevenueCents += revenue; showing.ticketsSold += 1;
      });
    }

    let fnbRevenueCents = 0;
    let fnbSeatCount = 0;
    for (const tab of tabs) {
      const revenue = tab.totalCents ?? 0;
      fnbRevenueCents += revenue;
      fnbSeatCount += tab.seats.length;
      if (tab.showtime) {
        ensureMovie(tab.showtime.movieId, tab.showtime.movie.title).fnbRevenueCents += revenue;
        ensureShowtime(tab.showtime.id, tab.showtime.movieId, tab.showtime.movie.title, tab.showtime.startsAt).fnbRevenueCents += revenue;
      }
    }

    return {
      range, totals: { ticketRevenueCents, fnbRevenueCents, combinedRevenueCents: ticketRevenueCents + fnbRevenueCents, ticketsSold: ticketOrders.reduce((sum, order) => sum + order.tickets.length, 0), fnbOrders: tabs.length, averageFnbSpendPerOrderCents: tabs.length ? Math.round(fnbRevenueCents / tabs.length) : 0, averageFnbSpendPerSeatCents: fnbSeatCount ? Math.round(fnbRevenueCents / fnbSeatCount) : 0 },
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
      const breakMinutes = shift.breakStartAt && shift.breakEndAt ? Math.max(0, Math.round((shift.breakEndAt.getTime() - shift.breakStartAt.getTime()) / 60_000)) : 0;
      const workedMinutes = Math.max(0, Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000) - breakMinutes);
      return { shiftId: shift.id, employeeId: shift.employeeId, employeeName: shift.employee.name, roles: shift.employee.employeeRoles.map((entry) => entry.role.name), clockInAt: shift.clockInAt, clockOutAt: shift.clockOutAt, breakMinutes, workedMinutes };
    });
    return { range, rows, totalMinutes: rows.reduce((sum, row) => sum + row.workedMinutes, 0) };
  }

  laborCsv(rows: Awaited<ReturnType<ReportingService["labor"]>>["rows"]) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return ["Employee,Roles,Clock in,Clock out,Break minutes,Worked minutes", ...rows.map((row) => [row.employeeName, row.roles.join("; "), row.clockInAt.toISOString(), row.clockOutAt?.toISOString() ?? "", row.breakMinutes, row.workedMinutes].map(quote).join(","))].join("\n");
  }
}
