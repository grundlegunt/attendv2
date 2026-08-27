import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, prisma } from "@cinema/database";
import { seatMapLayoutSchema } from "@cinema/shared";
import { AppError } from "../common/app-error";

export interface ReportRange { from: Date; to: Date }

type DistributorTerm = { startWeek: number; endWeek: number | null; distributorShareBasisPoints: number };

@Injectable()
export class ReportingService {
  private orderAheadRevenue(order: { orderAheadSubtotalCents: number; orderAheadTaxCents: number; orderAheadServiceChargeCents: number }) {
    return order.orderAheadSubtotalCents + order.orderAheadTaxCents + order.orderAheadServiceChargeCents;
  }

  private tabRevenue(tab: { totalCents: number | null; prepaidCents: number; status: string; payments: Array<{ refunds: Array<{ amountCents: number }> }> }) {
    const gross = Math.max(0, (tab.totalCents ?? 0) - tab.prepaidCents);
    const recordedRefunds = tab.payments.reduce((sum, payment) => sum + payment.refunds.reduce((refundSum, refund) => refundSum + refund.amountCents, 0), 0);
    const refunded = tab.status === "REFUNDED" && recordedRefunds === 0 ? gross : Math.min(gross, recordedRefunds);
    return { revenueCents: gross - refunded, refundedCents: refunded };
  }

  async platformRevenueTotals(locationIds: string[], range: ReportRange) {
    const totalsByLocation = new Map<string, { ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; membershipRevenueCents: number; membershipPurchases: number; donationRevenueCents: number; donations: number; nonprofitRevenueCents: number; totalCollectedCents: number; refundedCents: number; ticketsSold: number; fnbOrders: number }>();
    const totalsFor = (locationId: string) => {
      let totals = totalsByLocation.get(locationId);
      if (!totals) {
        totals = { ticketRevenueCents: 0, ticketFeesCents: 0, ticketTaxCents: 0, ticketCollectedCents: 0, fnbRevenueCents: 0, combinedRevenueCents: 0, membershipRevenueCents: 0, membershipPurchases: 0, donationRevenueCents: 0, donations: 0, nonprofitRevenueCents: 0, totalCollectedCents: 0, refundedCents: 0, ticketsSold: 0, fnbOrders: 0 };
        totalsByLocation.set(locationId, totals);
      }
      return totals;
    };
    if (locationIds.length === 0) return totalsByLocation;
    const [ticketOrders, tabs, membershipCheckouts, donations] = await Promise.all([
      prisma.ticketOrder.findMany({
        where: { locationId: { in: locationIds }, createdAt: { gte: range.from, lt: range.to }, status: { in: ["PAID", "EXCHANGED", "REFUNDED"] } },
        select: { locationId: true, status: true, totalCents: true, feesCents: true, taxCents: true, orderAheadSubtotalCents: true, orderAheadTaxCents: true, orderAheadServiceChargeCents: true, tickets: { select: { priceCentsPaid: true } } },
      }),
      prisma.restaurantTab.findMany({
        where: { locationId: { in: locationIds }, closedAt: { gte: range.from, lt: range.to }, status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } },
        select: { locationId: true, totalCents: true, prepaidCents: true, status: true, payments: { select: { refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true } } } } },
      }),
      prisma.membershipCheckout.findMany({
        where: { locationId: { in: locationIds }, createdAt: { gte: range.from, lt: range.to }, status: "PAID" },
        select: { locationId: true, amountCents: true },
      }),
      prisma.donation.findMany({
        where: { locationId: { in: locationIds }, receivedAt: { gte: range.from, lt: range.to }, status: "SETTLED" },
        select: { locationId: true, amountCents: true },
      }),
    ]);
    for (const order of ticketOrders) {
      const totals = totalsFor(order.locationId);
      const orderAheadRevenueCents = this.orderAheadRevenue(order);
      const ticketOrderCollectedCents = Math.max(0, order.totalCents - orderAheadRevenueCents);
      if (order.status === "REFUNDED") {
        totals.refundedCents += ticketOrderCollectedCents + orderAheadRevenueCents;
        continue;
      }
      if (order.tickets.length === 0) continue;
      totals.ticketRevenueCents += order.tickets.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
      totals.ticketFeesCents += order.feesCents;
      totals.ticketTaxCents += order.taxCents;
      totals.ticketCollectedCents += ticketOrderCollectedCents;
      totals.ticketsSold += order.tickets.length;
      if (orderAheadRevenueCents > 0) {
        totals.fnbRevenueCents += orderAheadRevenueCents;
        totals.fnbOrders += 1;
      }
    }
    for (const tab of tabs) {
      const totals = totalsFor(tab.locationId);
      const { revenueCents, refundedCents } = this.tabRevenue(tab);
      totals.refundedCents += refundedCents;
      if (revenueCents > 0) {
        totals.fnbRevenueCents += revenueCents;
        totals.fnbOrders += 1;
      }
    }
    for (const checkout of membershipCheckouts) {
      const totals = totalsFor(checkout.locationId);
      totals.membershipRevenueCents += checkout.amountCents;
      totals.membershipPurchases += 1;
    }
    for (const donation of donations) {
      const totals = totalsFor(donation.locationId);
      totals.donationRevenueCents += donation.amountCents;
      totals.donations += 1;
    }
    for (const totals of totalsByLocation.values()) {
      totals.combinedRevenueCents = totals.ticketCollectedCents + totals.fnbRevenueCents;
      totals.nonprofitRevenueCents = totals.membershipRevenueCents + totals.donationRevenueCents;
      totals.totalCollectedCents = totals.combinedRevenueCents + totals.nonprofitRevenueCents;
    }
    return totalsByLocation;
  }

  private advanceSalesBucket(purchasedAt: Date, startsAt: Date) {
    const hours = Math.max(0, (startsAt.getTime() - purchasedAt.getTime()) / 3_600_000);
    if (hours < 24) return { key: "SAME_DAY", label: "Same day", order: 0, hours };
    if (hours < 96) return { key: "ONE_TO_THREE_DAYS", label: "1–3 days ahead", order: 1, hours };
    if (hours < 192) return { key: "FOUR_TO_SEVEN_DAYS", label: "4–7 days ahead", order: 2, hours };
    if (hours < 360) return { key: "EIGHT_TO_FOURTEEN_DAYS", label: "8–14 days ahead", order: 3, hours };
    return { key: "FIFTEEN_PLUS_DAYS", label: "15+ days ahead", order: 4, hours };
  }

  allocateDistributorShare(ticketRevenueCents: number, startsAt: Date, openingStartsAt: Date | null, termsValue: Prisma.JsonValue | null) {
    const terms = Array.isArray(termsValue)
      ? termsValue.filter((term): term is DistributorTerm => {
          if (!term || typeof term !== "object" || Array.isArray(term)) return false;
          const value = term as Record<string, unknown>;
          return Number.isInteger(value.startWeek) && (value.endWeek === null || Number.isInteger(value.endWeek)) && Number.isInteger(value.distributorShareBasisPoints);
        })
      : [];
    if (!openingStartsAt) return { theatricalWeek: null, distributorShareBasisPoints: null, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: ticketRevenueCents, allocationComplete: false };
    const theatricalWeek = Math.max(1, Math.floor((startsAt.getTime() - openingStartsAt.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
    if (terms.length === 0) return { theatricalWeek, distributorShareBasisPoints: null, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: ticketRevenueCents, allocationComplete: false };
    const term = terms.find((candidate) => theatricalWeek >= candidate.startWeek && (candidate.endWeek === null || theatricalWeek <= candidate.endWeek));
    if (!term) return { theatricalWeek, distributorShareBasisPoints: null, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: ticketRevenueCents, allocationComplete: false };
    const distributorRevenueCents = Math.round(ticketRevenueCents * term.distributorShareBasisPoints / 10_000);
    return { theatricalWeek, distributorShareBasisPoints: term.distributorShareBasisPoints, distributorRevenueCents, cinemaRevenueCents: ticketRevenueCents - distributorRevenueCents, unallocatedRevenueCents: 0, allocationComplete: true };
  }

  async showtimeTicketMap(locationId: string, showtimeId: string) {
    const now = new Date();
    const showtime = await prisma.showtime.findFirst({
      where: { id: showtimeId, auditorium: { locationId } },
      select: {
        id: true, startsAt: true,
        movie: { select: { id: true, title: true } },
        auditorium: { select: { id: true, name: true, seatMap: { select: { layoutJson: true } }, location: { select: { currency: true, timezone: true } } } },
        showtimeSeats: { orderBy: [{ seat: { y: "asc" } }, { seat: { x: "asc" } }], select: {
          id: true, blockedAt: true,
          seat: { select: { id: true, label: true, x: true, y: true, type: true, tableGroupId: true, tablePosition: true } },
          holds: { where: { releasedAt: null, expiresAt: { gt: now } }, select: { id: true }, take: 1 },
          tickets: { where: { status: { notIn: ["REFUNDED", "CANCELED"] } }, select: { id: true, status: true, priceCentsPaid: true, ticketType: { select: { name: true } }, ticketOrder: { select: { orderNumber: true, channel: true } } }, take: 1 },
        } },
      },
    });
    if (!showtime) throw AppError.notFound("Showtime not found.");
    const layout = seatMapLayoutSchema.safeParse(showtime.auditorium.seatMap?.layoutJson);
    const seats = showtime.showtimeSeats.map((inventory) => ({
      id: inventory.seat.id, inventoryId: inventory.id, label: inventory.seat.label, x: inventory.seat.x, y: inventory.seat.y, type: inventory.seat.type,
      tableGroupId: inventory.seat.tableGroupId, tablePosition: inventory.seat.tablePosition,
      state: inventory.blockedAt ? "BLOCKED" : inventory.tickets.length ? "SOLD" : inventory.holds.length ? "HELD" : "AVAILABLE",
      ticket: inventory.tickets[0] ?? null,
    }));
    return {
      showtime: { id: showtime.id, startsAt: showtime.startsAt, movie: showtime.movie, auditorium: { id: showtime.auditorium.id, name: showtime.auditorium.name }, timezone: showtime.auditorium.location.timezone, currency: showtime.auditorium.location.currency, seatingStyle: layout.success ? layout.data.seatingStyle : "SINGLE" },
      seats,
      counts: { available: seats.filter((seat) => seat.state === "AVAILABLE").length, held: seats.filter((seat) => seat.state === "HELD").length, sold: seats.filter((seat) => seat.state === "SOLD").length, blocked: seats.filter((seat) => seat.state === "BLOCKED").length },
    };
  }

  async moviePerformance(locationId: string, movieId: string, range?: ReportRange) {
    const [movie, location] = await Promise.all([
      prisma.movie.findFirst({
        where: { id: movieId, organization: { locations: { some: { id: locationId } } } },
        select: { id: true, organizationId: true, title: true, synopsis: true, runtimeMinutes: true, rating: true, posterUrl: true, director: true, starring: true, releaseYear: true, distributorName: true, distributorTerms: true, active: true },
      }),
      prisma.location.findUnique({ where: { id: locationId }, select: { name: true, timezone: true, currency: true } }),
    ]);
    if (!movie) throw AppError.notFound("Film not found.");
    if (!location) throw AppError.notFound("Cinema location not found.");
    const [opening, showtimes, fnbOrderItems] = await Promise.all([
      prisma.showtime.findFirst({ where: { movieId, auditorium: { locationId } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
      prisma.showtime.findMany({
      where: { movieId, auditorium: { locationId }, ...(range ? { startsAt: { gte: range.from, lt: range.to } } : {}) },
      orderBy: { startsAt: "asc" },
      include: {
        auditorium: { select: { id: true, name: true, capacity: true } },
        filmSeries: { select: { id: true, name: true } },
        showtimeSeats: { select: { tickets: { select: { priceCentsPaid: true, status: true, ticketType: { select: { id: true, name: true } }, ticketOrder: { select: { id: true, createdAt: true, channel: true, zipCode: true, discountCents: true, orderAheadSubtotalCents: true, orderAheadTaxCents: true, orderAheadServiceChargeCents: true, customer: { select: { id: true, memberships: { where: { status: "ACTIVE" }, select: { organizationId: true } } } }, promotion: { select: { id: true, code: true, name: true, type: true } } } } } } } },
        restaurantTabs: { where: { status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } }, select: { totalCents: true, prepaidCents: true, status: true, payments: { select: { refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true } } } } } },
      },
      }),
      prisma.restaurantOrderItem.findMany({
        where: {
          status: "SENT",
          restaurantOrder: {
            status: { in: ["SENT", "IN_PROGRESS", "PARTIALLY_DELIVERED", "DELIVERED"] },
            restaurantTab: { locationId, showtime: { movieId, ...(range ? { startsAt: { gte: range.from, lt: range.to } } : {}) } },
          },
        },
        select: { menuItemId: true, quantity: true, unitPriceCentsSnapshot: true, modifierTotalCents: true, menuItem: { select: { name: true, chargeCategory: true } }, restaurantOrder: { select: { source: true } } },
      }),
    ]);
    const admissionTypes = new Map<string, { ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>();
    const salesChannels = new Map<string, { channel: string; ticketsSold: number; ticketRevenueCents: number }>();
    const promotions = new Map<string, { promotionId: string; code: string; name: string; type: string; orders: number; tickets: number; discountCents: number }>();
    const advanceSales = new Map<string, { key: string; label: string; order: number; ticketsSold: number; ticketRevenueCents: number; leadHours: number }>();
    const fnbItems = new Map<string, { menuItemId: string; name: string; chargeCategory: string; unitsSold: number; salesCents: number; orderAheadUnits: number; serviceUnits: number }>();
    const audienceOrigins = new Map<string, { zipCode: string; orders: Set<string>; tickets: number }>();
    const audienceOrdersWithZip = new Set<string>();
    const customerSegments = new Map<string, { key: string; label: string; orders: Set<string>; tickets: number; ticketRevenueCents: number }>();
    const countedOrders = new Set<string>();
    let discountCents = 0; let complimentaryTickets = 0; let refundedTickets = 0; let refundedTicketValueCents = 0;
    const rows = showtimes.map((showtime) => {
      const allTickets = showtime.showtimeSeats.flatMap((seat) => seat.tickets);
      const tickets = allTickets.filter((ticket) => !["REFUNDED", "CANCELED"].includes(ticket.status));
      const refunded = allTickets.filter((ticket) => ticket.status === "REFUNDED");
      refundedTickets += refunded.length; refundedTicketValueCents += refunded.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
      for (const ticket of tickets) {
        const customer = ticket.ticketOrder.customer;
        const segment = customer?.memberships.some((membership) => membership.organizationId === movie.organizationId)
          ? { key: "ACTIVE_MEMBER", label: "Active members" }
          : customer ? { key: "IDENTIFIED_CUSTOMER", label: "Identified non-members" }
          : { key: "GUEST", label: "Guests" };
        const customerSegment = customerSegments.get(segment.key) ?? { ...segment, orders: new Set<string>(), tickets: 0, ticketRevenueCents: 0 };
        customerSegment.orders.add(ticket.ticketOrder.id);
        customerSegment.tickets += 1;
        customerSegment.ticketRevenueCents += ticket.priceCentsPaid;
        customerSegments.set(segment.key, customerSegment);
        const zipCode = ticket.ticketOrder.zipCode?.trim().match(/^(\d{5})(?:-\d{4})?$/)?.[1];
        if (zipCode) {
          audienceOrdersWithZip.add(ticket.ticketOrder.id);
          const origin = audienceOrigins.get(zipCode) ?? { zipCode, orders: new Set<string>(), tickets: 0 };
          origin.orders.add(ticket.ticketOrder.id);
          origin.tickets += 1;
          audienceOrigins.set(zipCode, origin);
        }
        const bucket = this.advanceSalesBucket(ticket.ticketOrder.createdAt, showtime.startsAt);
        const pace = advanceSales.get(bucket.key) ?? { key: bucket.key, label: bucket.label, order: bucket.order, ticketsSold: 0, ticketRevenueCents: 0, leadHours: 0 };
        pace.ticketsSold += 1; pace.ticketRevenueCents += ticket.priceCentsPaid; pace.leadHours += bucket.hours; advanceSales.set(bucket.key, pace);
        const admission = admissionTypes.get(ticket.ticketType.id) ?? { ticketTypeId: ticket.ticketType.id, name: ticket.ticketType.name, ticketsSold: 0, ticketRevenueCents: 0 };
        admission.ticketsSold += 1; admission.ticketRevenueCents += ticket.priceCentsPaid; admissionTypes.set(ticket.ticketType.id, admission);
        const channel = salesChannels.get(ticket.ticketOrder.channel) ?? { channel: ticket.ticketOrder.channel, ticketsSold: 0, ticketRevenueCents: 0 };
        channel.ticketsSold += 1; channel.ticketRevenueCents += ticket.priceCentsPaid; salesChannels.set(ticket.ticketOrder.channel, channel);
        if (!countedOrders.has(ticket.ticketOrder.id)) {
          countedOrders.add(ticket.ticketOrder.id); discountCents += ticket.ticketOrder.discountCents;
          const promotion = ticket.ticketOrder.promotion;
          if (promotion) {
            const promotionRow = promotions.get(promotion.id) ?? { promotionId: promotion.id, code: promotion.code, name: promotion.name, type: promotion.type, orders: 0, tickets: 0, discountCents: 0 };
            promotionRow.orders += 1; promotionRow.discountCents += ticket.ticketOrder.discountCents; promotions.set(promotion.id, promotionRow);
          }
        }
        const promotion = ticket.ticketOrder.promotion;
        if (promotion) { const promotionRow = promotions.get(promotion.id)!; promotionRow.tickets += 1; if (promotion.type === "COMP") complimentaryTickets += 1; }
      }
      const ticketRevenueCents = tickets.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
      const orderAheadRevenueCents = [...new Map(tickets.map((ticket) => [ticket.ticketOrder.id, ticket.ticketOrder] as const)).values()].reduce((sum, order) => sum + this.orderAheadRevenue(order), 0);
      const fnbRevenueCents = orderAheadRevenueCents + showtime.restaurantTabs.reduce((sum, tab) => sum + this.tabRevenue(tab).revenueCents, 0);
      return { showtimeId: showtime.id, startsAt: showtime.startsAt, auditorium: showtime.auditorium, filmSeries: showtime.filmSeries, ticketsSold: tickets.length, capacity: showtime.auditorium.capacity, ticketRevenueCents, fnbRevenueCents, ...this.allocateDistributorShare(ticketRevenueCents, showtime.startsAt, opening?.startsAt ?? null, movie.distributorTerms) };
    });
    for (const item of fnbOrderItems) {
      const row = fnbItems.get(item.menuItemId) ?? { menuItemId: item.menuItemId, name: item.menuItem.name, chargeCategory: item.menuItem.chargeCategory, unitsSold: 0, salesCents: 0, orderAheadUnits: 0, serviceUnits: 0 };
      row.unitsSold += item.quantity;
      row.salesCents += (item.unitPriceCentsSnapshot + item.modifierTotalCents) * item.quantity;
      if (item.restaurantOrder.source === "ONLINE_ORDER_AHEAD") row.orderAheadUnits += item.quantity;
      else row.serviceUnits += item.quantity;
      fnbItems.set(item.menuItemId, row);
    }
    const ticketsSold = rows.reduce((sum, row) => sum + row.ticketsSold, 0);
    const ticketsWithZip = [...audienceOrigins.values()].reduce((sum, origin) => sum + origin.tickets, 0);
    const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    const ticketRevenueCents = rows.reduce((sum, row) => sum + row.ticketRevenueCents, 0);
    const fnbRevenueCents = rows.reduce((sum, row) => sum + row.fnbRevenueCents, 0);
    const first = showtimes[0]?.startsAt ?? null;
    const last = showtimes.at(-1)?.startsAt ?? null;
    const calendarWeeks = first && last ? Math.max(1, Math.ceil((last.getTime() - first.getTime() + 1) / (7 * 24 * 60 * 60 * 1000))) : 0;
    const localDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: location.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const localDate = (value: Date) => {
      const parts = Object.fromEntries(localDateFormatter.formatToParts(value).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const dailyPerformance = new Map<string, { date: string; showtimes: number; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>();
    const weeklyPerformance = new Map<number, { theatricalWeek: number; firstShowtime: Date; lastShowtime: Date; showtimes: number; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>();
    for (const row of rows) {
      const date = localDate(row.startsAt);
      const day = dailyPerformance.get(date) ?? { date, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0 };
      day.showtimes += 1; day.ticketsSold += row.ticketsSold; day.capacity += row.capacity; day.ticketRevenueCents += row.ticketRevenueCents; day.fnbRevenueCents += row.fnbRevenueCents; day.distributorRevenueCents += row.distributorRevenueCents; day.cinemaRevenueCents += row.cinemaRevenueCents; day.unallocatedRevenueCents += row.unallocatedRevenueCents;
      dailyPerformance.set(date, day);
      const theatricalWeek = row.theatricalWeek ?? 1;
      const week = weeklyPerformance.get(theatricalWeek) ?? { theatricalWeek, firstShowtime: row.startsAt, lastShowtime: row.startsAt, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0 };
      week.firstShowtime = row.startsAt < week.firstShowtime ? row.startsAt : week.firstShowtime; week.lastShowtime = row.startsAt > week.lastShowtime ? row.startsAt : week.lastShowtime;
      week.showtimes += 1; week.ticketsSold += row.ticketsSold; week.capacity += row.capacity; week.ticketRevenueCents += row.ticketRevenueCents; week.fnbRevenueCents += row.fnbRevenueCents; week.distributorRevenueCents += row.distributorRevenueCents; week.cinemaRevenueCents += row.cinemaRevenueCents; week.unallocatedRevenueCents += row.unallocatedRevenueCents;
      weeklyPerformance.set(theatricalWeek, week);
    }
    type PerformanceSlice = { key: string; label: string; showtimes: number; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number };
    const auditoriumPerformance = new Map<string, PerformanceSlice>();
    const daypartPerformance = new Map<string, PerformanceSlice>();
    const weekdayPerformance = new Map<string, PerformanceSlice>();
    const hourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: location.timezone, hour: "numeric", hourCycle: "h23" });
    const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: location.timezone, weekday: "long" });
    for (const row of rows) {
      const room = auditoriumPerformance.get(row.auditorium.id) ?? { key: row.auditorium.id, label: row.auditorium.name, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0 };
      room.showtimes += 1; room.ticketsSold += row.ticketsSold; room.capacity += row.capacity; room.ticketRevenueCents += row.ticketRevenueCents; room.fnbRevenueCents += row.fnbRevenueCents; auditoriumPerformance.set(room.key, room);
      const hour = Number(hourFormatter.format(row.startsAt));
      const daypart = hour < 12 ? { key: "MORNING", label: "Morning" } : hour < 17 ? { key: "AFTERNOON", label: "Afternoon" } : { key: "EVENING", label: "Evening" };
      const period = daypartPerformance.get(daypart.key) ?? { ...daypart, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0 };
      period.showtimes += 1; period.ticketsSold += row.ticketsSold; period.capacity += row.capacity; period.ticketRevenueCents += row.ticketRevenueCents; period.fnbRevenueCents += row.fnbRevenueCents; daypartPerformance.set(period.key, period);
      const weekday = weekdayFormatter.format(row.startsAt);
      const day = weekdayPerformance.get(weekday) ?? { key: weekday.toUpperCase(), label: weekday, showtimes: 0, ticketsSold: 0, capacity: 0, ticketRevenueCents: 0, fnbRevenueCents: 0 };
      day.showtimes += 1; day.ticketsSold += row.ticketsSold; day.capacity += row.capacity; day.ticketRevenueCents += row.ticketRevenueCents; day.fnbRevenueCents += row.fnbRevenueCents; weekdayPerformance.set(weekday, day);
    }
    const finishSlice = (slice: PerformanceSlice) => ({ ...slice, attendancePercent: slice.capacity ? Math.round((slice.ticketsSold / slice.capacity) * 1000) / 10 : 0, averageTicketsPerShow: slice.showtimes ? Math.round((slice.ticketsSold / slice.showtimes) * 10) / 10 : 0, averageTicketRevenuePerShowCents: slice.showtimes ? Math.round(slice.ticketRevenueCents / slice.showtimes) : 0, averageFnbPerShowCents: slice.showtimes ? Math.round(slice.fnbRevenueCents / slice.showtimes) : 0 });
    const now = new Date();
    return {
      movie: { ...movie, distributorTerms: undefined }, location, range: range ?? null,
      totals: {
        showtimes: rows.length, upcomingShowtimes: rows.filter((row) => row.startsAt >= now).length, pastShowtimes: rows.filter((row) => row.startsAt < now).length,
        ticketsSold, totalCapacity, attendancePercent: totalCapacity ? Math.round((ticketsSold / totalCapacity) * 1000) / 10 : 0,
        averageTicketsPerShow: rows.length ? Math.round((ticketsSold / rows.length) * 10) / 10 : 0, averageTicketCents: ticketsSold ? Math.round(ticketRevenueCents / ticketsSold) : 0,
        ticketRevenueCents, fnbRevenueCents, averageFnbPerShowCents: rows.length ? Math.round(fnbRevenueCents / rows.length) : 0, averageFnbPerTicketCents: ticketsSold ? Math.round(fnbRevenueCents / ticketsSold) : 0,
        distributorRevenueCents: rows.reduce((sum, row) => sum + row.distributorRevenueCents, 0), cinemaRevenueCents: rows.reduce((sum, row) => sum + row.cinemaRevenueCents, 0), unallocatedRevenueCents: rows.reduce((sum, row) => sum + row.unallocatedRevenueCents, 0),
        discountCents, complimentaryTickets, refundedTickets, refundedTicketValueCents,
        firstShowtime: first, lastShowtime: last, calendarWeeks, averageShowtimesPerWeek: calendarWeeks ? Math.round((rows.length / calendarWeeks) * 10) / 10 : 0,
      },
      series: [...new Map(rows.flatMap((row) => row.filmSeries ? [[row.filmSeries.id, row.filmSeries] as const] : [])).values()],
      admissionTypes: [...admissionTypes.values()].sort((left, right) => right.ticketsSold - left.ticketsSold || left.name.localeCompare(right.name)),
      salesChannels: [...salesChannels.values()].sort((left, right) => right.ticketsSold - left.ticketsSold || left.channel.localeCompare(right.channel)),
      promotions: [...promotions.values()].sort((left, right) => right.discountCents - left.discountCents || left.code.localeCompare(right.code)),
      advanceSales: [...advanceSales.values()].sort((left, right) => left.order - right.order).map(({ order: _order, leadHours, ...bucket }) => ({ ...bucket, percentOfTickets: ticketsSold ? Math.round((bucket.ticketsSold / ticketsSold) * 1000) / 10 : 0, averageLeadHours: bucket.ticketsSold ? Math.round(leadHours / bucket.ticketsSold) : 0 })),
      audienceOrigins: {
        totals: { completedOrders: countedOrders.size, ordersWithZip: audienceOrdersWithZip.size, ticketsWithZip, coveragePercent: countedOrders.size ? Math.round((audienceOrdersWithZip.size / countedOrders.size) * 100) : 0 },
        origins: [...audienceOrigins.values()].map((origin) => ({ zipCode: origin.zipCode, orders: origin.orders.size, tickets: origin.tickets, sharePercent: ticketsWithZip ? Math.round((origin.tickets / ticketsWithZip) * 1000) / 10 : 0 })).sort((left, right) => right.tickets - left.tickets || right.orders - left.orders || left.zipCode.localeCompare(right.zipCode)),
      },
      customerSegments: [...customerSegments.values()].map((segment) => ({ key: segment.key, label: segment.label, orders: segment.orders.size, ticketsSold: segment.tickets, ticketRevenueCents: segment.ticketRevenueCents, percentOfTickets: ticketsSold ? Math.round((segment.tickets / ticketsSold) * 1000) / 10 : 0 })).sort((left, right) => right.ticketsSold - left.ticketsSold || left.label.localeCompare(right.label)),
      fnbItems: [...fnbItems.values()].sort((left, right) => right.salesCents - left.salesCents || right.unitsSold - left.unitsSold || left.name.localeCompare(right.name)),
      auditoriumPerformance: [...auditoriumPerformance.values()].map(finishSlice).sort((left, right) => right.ticketRevenueCents - left.ticketRevenueCents || left.label.localeCompare(right.label)),
      daypartPerformance: [...daypartPerformance.values()].map(finishSlice).sort((left, right) => ["MORNING", "AFTERNOON", "EVENING"].indexOf(left.key) - ["MORNING", "AFTERNOON", "EVENING"].indexOf(right.key)),
      weekdayPerformance: [...weekdayPerformance.values()].map(finishSlice).sort((left, right) => ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(left.key) - ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(right.key)),
      dailyPerformance: [...dailyPerformance.values()].sort((left, right) => left.date.localeCompare(right.date)).map((day) => ({ ...day, attendancePercent: day.capacity ? Math.round((day.ticketsSold / day.capacity) * 1000) / 10 : 0, averageTicketsPerShow: day.showtimes ? Math.round((day.ticketsSold / day.showtimes) * 10) / 10 : 0, averageFnbPerShowCents: day.showtimes ? Math.round(day.fnbRevenueCents / day.showtimes) : 0 })),
      weeklyPerformance: [...weeklyPerformance.values()].sort((left, right) => left.theatricalWeek - right.theatricalWeek).map((week) => ({ ...week, attendancePercent: week.capacity ? Math.round((week.ticketsSold / week.capacity) * 1000) / 10 : 0, averageTicketsPerShow: week.showtimes ? Math.round((week.ticketsSold / week.showtimes) * 10) / 10 : 0, averageFnbPerShowCents: week.showtimes ? Math.round(week.fnbRevenueCents / week.showtimes) : 0 })),
      showtimes: rows,
    };
  }

  async distributorPerformance(locationId: string, distributorName?: string, range?: ReportRange) {
    const location = await prisma.location.findUnique({ where: { id: locationId }, select: { name: true, timezone: true, currency: true, organizationId: true } });
    if (!location) throw AppError.notFound("Cinema location not found.");
    const movies = await prisma.movie.findMany({
      where: { organizationId: location.organizationId, distributorName: distributorName ? { equals: distributorName, mode: "insensitive" } : { not: null } },
      orderBy: { title: "asc" },
      select: { id: true, title: true, posterUrl: true, distributorName: true, distributorTerms: true, active: true, showtimes: { where: { auditorium: { locationId }, ...(range ? { startsAt: { gte: range.from, lt: range.to } } : {}) }, orderBy: { startsAt: "asc" }, include: { auditorium: { select: { id: true, name: true, capacity: true } }, showtimeSeats: { select: { tickets: { where: { status: { notIn: ["REFUNDED", "CANCELED"] } }, select: { priceCentsPaid: true, ticketOrder: { select: { id: true, orderAheadSubtotalCents: true, orderAheadTaxCents: true, orderAheadServiceChargeCents: true } } } } } }, restaurantTabs: { where: { status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } }, select: { totalCents: true, prepaidCents: true, status: true, payments: { select: { refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true } } } } } } } } },
    });
    if (distributorName && !movies.length) throw AppError.notFound("Distributor not found.");
    const openingShowtimes = movies.length ? await prisma.showtime.findMany({ where: { movieId: { in: movies.map((movie) => movie.id) }, auditorium: { locationId } }, orderBy: [{ movieId: "asc" }, { startsAt: "asc" }], distinct: ["movieId"], select: { movieId: true, startsAt: true } }) : [];
    const openingByMovie = new Map(openingShowtimes.map((showtime) => [showtime.movieId, showtime.startsAt]));
    const now = new Date();
    const filmRows = movies.map((movie) => {
      const showingRows = movie.showtimes.map((showtime) => {
        const tickets = showtime.showtimeSeats.flatMap((seat) => seat.tickets);
        const ticketRevenueCents = tickets.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
        const orderAheadRevenueCents = [...new Map(tickets.map((ticket) => [ticket.ticketOrder.id, ticket.ticketOrder] as const)).values()].reduce((sum, order) => sum + this.orderAheadRevenue(order), 0);
        const fnbRevenueCents = orderAheadRevenueCents + showtime.restaurantTabs.reduce((sum, tab) => sum + this.tabRevenue(tab).revenueCents, 0);
        return { showtimeId: showtime.id, startsAt: showtime.startsAt, auditorium: showtime.auditorium, ticketsSold: tickets.length, ticketRevenueCents, fnbRevenueCents, ...this.allocateDistributorShare(ticketRevenueCents, showtime.startsAt, openingByMovie.get(movie.id) ?? null, movie.distributorTerms) };
      });
      const upcomingShowtimes = showingRows.filter((row) => row.startsAt >= now).length;
      const pastShowtimes = showingRows.length - upcomingShowtimes;
      const dealStatus = upcomingShowtimes && pastShowtimes ? "CURRENT" : upcomingShowtimes ? "UPCOMING" : pastShowtimes ? "PAST" : "UNSCHEDULED";
      const ticketsSold = showingRows.reduce((sum, row) => sum + row.ticketsSold, 0);
      const totalCapacity = showingRows.reduce((sum, row) => sum + row.auditorium.capacity, 0);
      return { movieId: movie.id, title: movie.title, posterUrl: movie.posterUrl, distributorName: movie.distributorName!, active: movie.active, dealStatus, terms: Array.isArray(movie.distributorTerms) ? movie.distributorTerms : [], showtimes: showingRows.length, upcomingShowtimes, pastShowtimes, ticketsSold, totalCapacity, attendancePercent: totalCapacity ? Math.round((ticketsSold / totalCapacity) * 1000) / 10 : 0, ticketRevenueCents: showingRows.reduce((sum, row) => sum + row.ticketRevenueCents, 0), fnbRevenueCents: showingRows.reduce((sum, row) => sum + row.fnbRevenueCents, 0), distributorRevenueCents: showingRows.reduce((sum, row) => sum + row.distributorRevenueCents, 0), cinemaRevenueCents: showingRows.reduce((sum, row) => sum + row.cinemaRevenueCents, 0), unallocatedRevenueCents: showingRows.reduce((sum, row) => sum + row.unallocatedRevenueCents, 0), firstShowtime: showingRows[0]?.startsAt ?? null, lastShowtime: showingRows.at(-1)?.startsAt ?? null };
    });
    const distributorRows = new Map<string, { name: string; films: typeof filmRows; showtimes: number; upcomingShowtimes: number; pastShowtimes: number; ticketsSold: number; totalCapacity: number; attendancePercent: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>();
    for (const film of filmRows) {
      const key = film.distributorName.toLocaleLowerCase();
      const row = distributorRows.get(key) ?? { name: film.distributorName, films: [], showtimes: 0, upcomingShowtimes: 0, pastShowtimes: 0, ticketsSold: 0, totalCapacity: 0, attendancePercent: 0, ticketRevenueCents: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0 };
      row.films.push(film); row.showtimes += film.showtimes; row.upcomingShowtimes += film.upcomingShowtimes; row.pastShowtimes += film.pastShowtimes; row.ticketsSold += film.ticketsSold; row.totalCapacity += film.totalCapacity; row.attendancePercent = row.totalCapacity ? Math.round((row.ticketsSold / row.totalCapacity) * 1000) / 10 : 0; row.ticketRevenueCents += film.ticketRevenueCents; row.fnbRevenueCents += film.fnbRevenueCents; row.distributorRevenueCents += film.distributorRevenueCents; row.cinemaRevenueCents += film.cinemaRevenueCents; row.unallocatedRevenueCents += film.unallocatedRevenueCents;
      distributorRows.set(key, row);
    }
    const distributors = [...distributorRows.values()].sort((left, right) => right.ticketRevenueCents - left.ticketRevenueCents || left.name.localeCompare(right.name));
    return { location: { name: location.name, timezone: location.timezone, currency: location.currency }, range: range ?? null, distributors, distributor: distributorName ? distributors[0] ?? null : null };
  }

  async filmSeriesPerformance(locationId: string, seriesId: string, range?: ReportRange) {
    const [series, location] = await Promise.all([prisma.filmSeries.findFirst({
      where: { id: seriesId, organization: { locations: { some: { id: locationId } } } },
      select: { id: true, name: true, description: true, artworkUrl: true, active: true },
    }), prisma.location.findUnique({ where: { id: locationId }, select: { name: true, timezone: true, currency: true } })]);
    if (!series) throw AppError.notFound("Film series not found.");
    if (!location) throw AppError.notFound("Cinema location not found.");
    const showtimes = await prisma.showtime.findMany({
      where: { filmSeriesId: seriesId, auditorium: { locationId }, ...(range ? { startsAt: { gte: range.from, lt: range.to } } : {}) },
      orderBy: { startsAt: "asc" },
      include: {
        movie: { select: { id: true, title: true, posterUrl: true, distributorName: true, distributorTerms: true } },
        auditorium: { select: { id: true, name: true, capacity: true } },
        showtimeSeats: { select: { tickets: { where: { status: { notIn: ["REFUNDED", "CANCELED"] } }, select: { priceCentsPaid: true, ticketOrder: { select: { id: true, orderAheadSubtotalCents: true, orderAheadTaxCents: true, orderAheadServiceChargeCents: true } } } } } },
        restaurantTabs: { where: { status: { in: ["CLOSED", "REFUNDED", "MANAGER_REVIEW"] } }, select: { totalCents: true, prepaidCents: true, status: true, payments: { select: { refunds: { where: { status: "SUCCEEDED" }, select: { amountCents: true } } } } } },
      },
    });
    const movieIds = [...new Set(showtimes.map((showtime) => showtime.movieId))];
    const openings = movieIds.length ? await prisma.showtime.findMany({
      where: { movieId: { in: movieIds }, auditorium: { locationId } },
      distinct: ["movieId"], orderBy: [{ movieId: "asc" }, { startsAt: "asc" }], select: { movieId: true, startsAt: true },
    }) : [];
    const openingByMovie = new Map(openings.map((showtime) => [showtime.movieId, showtime.startsAt]));
    const movieRows = new Map<string, { movieId: string; title: string; posterUrl: string | null; distributorName: string | null; showtimes: number; ticketsSold: number; totalCapacity: number; attendancePercent: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>();
    const rows = showtimes.map((showtime) => {
      const tickets = showtime.showtimeSeats.flatMap((seat) => seat.tickets);
      const ticketRevenueCents = tickets.reduce((sum, ticket) => sum + ticket.priceCentsPaid, 0);
      const orderAheadRevenueCents = [...new Map(tickets.map((ticket) => [ticket.ticketOrder.id, ticket.ticketOrder] as const)).values()].reduce((sum, order) => sum + this.orderAheadRevenue(order), 0);
      const fnbRevenueCents = orderAheadRevenueCents + showtime.restaurantTabs.reduce((sum, tab) => sum + this.tabRevenue(tab).revenueCents, 0);
      const allocation = this.allocateDistributorShare(ticketRevenueCents, showtime.startsAt, openingByMovie.get(showtime.movieId) ?? null, showtime.movie.distributorTerms);
      const movie = movieRows.get(showtime.movieId) ?? { movieId: showtime.movieId, title: showtime.movie.title, posterUrl: showtime.movie.posterUrl, distributorName: showtime.movie.distributorName, showtimes: 0, ticketsSold: 0, totalCapacity: 0, attendancePercent: 0, ticketRevenueCents: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0 };
      movie.showtimes += 1; movie.ticketsSold += tickets.length; movie.totalCapacity += showtime.auditorium.capacity; movie.attendancePercent = movie.totalCapacity ? Math.round((movie.ticketsSold / movie.totalCapacity) * 1000) / 10 : 0; movie.ticketRevenueCents += ticketRevenueCents; movie.fnbRevenueCents += fnbRevenueCents; movie.distributorRevenueCents += allocation.distributorRevenueCents; movie.cinemaRevenueCents += allocation.cinemaRevenueCents; movie.unallocatedRevenueCents += allocation.unallocatedRevenueCents;
      movieRows.set(showtime.movieId, movie);
      return { showtimeId: showtime.id, startsAt: showtime.startsAt, auditorium: showtime.auditorium, movie: { id: showtime.movie.id, title: showtime.movie.title }, ticketsSold: tickets.length, capacity: showtime.auditorium.capacity, ticketRevenueCents, fnbRevenueCents, ...allocation };
    });
    const ticketsSold = rows.reduce((sum, row) => sum + row.ticketsSold, 0);
    const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    const ticketRevenueCents = rows.reduce((sum, row) => sum + row.ticketRevenueCents, 0);
    const fnbRevenueCents = rows.reduce((sum, row) => sum + row.fnbRevenueCents, 0);
    const first = showtimes[0]?.startsAt ?? null;
    const last = showtimes.at(-1)?.startsAt ?? null;
    const calendarWeeks = first && last ? Math.max(1, Math.ceil((last.getTime() - first.getTime() + 1) / (7 * 24 * 60 * 60 * 1000))) : 0;
    const now = new Date();
    return {
      series, location, range: range ?? null,
      totals: { showtimes: rows.length, upcomingShowtimes: rows.filter((row) => row.startsAt >= now).length, pastShowtimes: rows.filter((row) => row.startsAt < now).length, uniqueFilms: movieRows.size, ticketsSold, totalCapacity, attendancePercent: totalCapacity ? Math.round((ticketsSold / totalCapacity) * 1000) / 10 : 0, averageTicketsPerShow: rows.length ? Math.round((ticketsSold / rows.length) * 10) / 10 : 0, averageTicketCents: ticketsSold ? Math.round(ticketRevenueCents / ticketsSold) : 0, ticketRevenueCents, fnbRevenueCents, averageFnbPerShowCents: rows.length ? Math.round(fnbRevenueCents / rows.length) : 0, distributorRevenueCents: rows.reduce((sum, row) => sum + row.distributorRevenueCents, 0), cinemaRevenueCents: rows.reduce((sum, row) => sum + row.cinemaRevenueCents, 0), unallocatedRevenueCents: rows.reduce((sum, row) => sum + row.unallocatedRevenueCents, 0), firstShowtime: first, lastShowtime: last, calendarWeeks, averageShowtimesPerWeek: calendarWeeks ? Math.round((rows.length / calendarWeeks) * 10) / 10 : 0 },
      movies: [...movieRows.values()].sort((left, right) => right.ticketRevenueCents - left.ticketRevenueCents || left.title.localeCompare(right.title)),
      showtimes: rows,
    };
  }

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

  async deleteExpense(locationId: string, employeeId: string, expenseId: string, suppliedRequestId?: string) {
    const requestId = suppliedRequestId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw AppError.validationFailed("Idempotency key must be a UUID.");
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ locationId, expenseId })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
      const replay = await tx.auditEvent.findFirst({ where: { locationId, action: "expense.deleted", afterState: { path: ["requestId"], equals: requestId } } });
      if (replay) {
        const state = replay.afterState as { requestFingerprint?: string } | null;
        if (state?.requestFingerprint !== requestFingerprint) throw AppError.conflict("The expense-deletion idempotency key was already used for another entry.");
        return { deleted: true };
      }
      const expense = await tx.expense.findFirst({ where: { id: expenseId, locationId } });
      if (!expense) throw AppError.notFound("Expense entry not found.");
      await tx.expense.delete({ where: { id: expense.id } });
      await tx.auditEvent.create({ data: { actorType: "EMPLOYEE", actorId: employeeId, locationId, action: "expense.deleted", entityType: "Expense", entityId: expense.id, beforeState: expense, afterState: { requestId, requestFingerprint, deleted: true } } });
      return { deleted: true };
    });
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

    const soldMovieIds = [...new Set(ticketOrders.flatMap((order) => order.status === "REFUNDED" ? [] : order.tickets.map((ticket) => ticket.showtimeSeat.showtime.movieId)))];
    const openingShowtimes = soldMovieIds.length ? await prisma.showtime.findMany({ where: { movieId: { in: soldMovieIds }, auditorium: { locationId } }, orderBy: [{ movieId: "asc" }, { startsAt: "asc" }], distinct: ["movieId"], select: { movieId: true, startsAt: true } }) : [];
    const openingByMovie = new Map(openingShowtimes.map((showtime) => [showtime.movieId, showtime.startsAt]));
    const movieMetadata = new Map<string, { distributorName: string | null; distributorTerms: Prisma.JsonValue | null }>();
    const movies = new Map<string, { movieId: string; title: string; distributorName: string | null; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; allocationComplete: boolean }>();
    const showtimes = new Map<string, { showtimeId: string; movieId: string; title: string; distributorName: string | null; startsAt: Date; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number; theatricalWeek: number | null; distributorShareBasisPoints: number | null; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; allocationComplete: boolean }>();
    const admissionTypes = new Map<string, { ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>();
    const salesChannels = new Map<string, { channel: string; ticketsSold: number; ticketRevenueCents: number; ticketFeesCents: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>();
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
      if (!row) { row = { movieId, title, distributorName: movieMetadata.get(movieId)?.distributorName ?? null, ticketRevenueCents: 0, ticketsSold: 0, fnbRevenueCents: 0, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0, allocationComplete: true }; movies.set(movieId, row); }
      return row;
    };
    const ensureShowtime = (showtimeId: string, movieId: string, title: string, startsAt: Date) => {
      let row = showtimes.get(showtimeId);
      if (!row) { row = { showtimeId, movieId, title, distributorName: movieMetadata.get(movieId)?.distributorName ?? null, startsAt, ticketRevenueCents: 0, ticketsSold: 0, fnbRevenueCents: 0, theatricalWeek: null, distributorShareBasisPoints: null, distributorRevenueCents: 0, cinemaRevenueCents: 0, unallocatedRevenueCents: 0, allocationComplete: true }; showtimes.set(showtimeId, row); }
      return row;
    };

    let ticketRevenueCents = 0;
    let ticketFeesCents = 0;
    let ticketTaxCents = 0;
    let ticketCollectedCents = 0;
    let ticketRefundedCents = 0;
    let fnbRevenueCents = 0;
    let fnbRefundedCents = 0;
    let fnbSeatCount = 0;
    let fnbOrderCount = 0;
    for (const order of ticketOrders) {
      const orderAheadRevenueCents = this.orderAheadRevenue(order);
      const ticketOrderCollectedCents = Math.max(0, order.totalCents - orderAheadRevenueCents);
      const salesChannel = salesChannels.get(order.channel) ?? { channel: order.channel, ticketsSold: 0, ticketRevenueCents: 0, ticketFeesCents: 0, grossCollectedCents: 0, refundedCents: 0, netCollectedCents: 0 };
      salesChannel.grossCollectedCents += order.totalCents;
      const salesOperator = order.placedByEmployee
        ? salesOperators.get(order.placedByEmployee.id) ?? { employeeId: order.placedByEmployee.id, employeeName: order.placedByEmployee.name, ticketsSold: 0, grossCollectedCents: 0, refundedCents: 0, netCollectedCents: 0 }
        : null;
      if (salesOperator) salesOperator.grossCollectedCents += order.totalCents;
      if (order.status === "REFUNDED") {
        ticketRefundedCents += ticketOrderCollectedCents;
        fnbRefundedCents += orderAheadRevenueCents;
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
      salesChannel.ticketFeesCents += order.feesCents;
      ticketTaxCents += order.taxCents;
      ticketCollectedCents += ticketOrderCollectedCents;
      const orderDay = ensureDay(order.createdAt);
      orderDay.ticketsSold += order.tickets.length;
      orderDay.ticketCollectedCents += ticketOrderCollectedCents;
      if (orderAheadRevenueCents > 0) {
        fnbRevenueCents += orderAheadRevenueCents; fnbOrderCount += 1; fnbSeatCount += order.tickets.length; orderDay.fnbRevenueCents += orderAheadRevenueCents;
      }
      salesChannel.ticketsSold += order.tickets.length;
      if (salesOperator) salesOperator.ticketsSold += order.tickets.length;
      order.tickets.forEach((ticket, ticketIndex) => {
        const showtime = ticket.showtimeSeat.showtime;
        movieMetadata.set(showtime.movieId, { distributorName: showtime.movie.distributorName, distributorTerms: showtime.movie.distributorTerms });
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
        if (ticketIndex === 0 && orderAheadRevenueCents > 0) { movie.fnbRevenueCents += orderAheadRevenueCents; showing.fnbRevenueCents += orderAheadRevenueCents; }
      });
      salesChannels.set(order.channel, salesChannel);
      if (salesOperator) salesOperators.set(salesOperator.employeeId, salesOperator);
    }

    for (const tab of tabs) {
      const { revenueCents: revenue, refundedCents: refunded } = this.tabRevenue(tab);
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
    for (const showing of showtimes.values()) {
      const allocation = this.allocateDistributorShare(showing.ticketRevenueCents, showing.startsAt, openingByMovie.get(showing.movieId) ?? null, movieMetadata.get(showing.movieId)?.distributorTerms ?? null);
      Object.assign(showing, allocation);
      const movie = movies.get(showing.movieId)!;
      movie.distributorName = showing.distributorName;
      movie.distributorRevenueCents += allocation.distributorRevenueCents;
      movie.cinemaRevenueCents += allocation.cinemaRevenueCents;
      movie.unallocatedRevenueCents += allocation.unallocatedRevenueCents;
      movie.allocationComplete &&= allocation.allocationComplete;
    }
    const distributorRevenueCents = [...movies.values()].reduce((sum, movie) => sum + movie.distributorRevenueCents, 0);
    const cinemaFilmRevenueCents = [...movies.values()].reduce((sum, movie) => sum + movie.cinemaRevenueCents, 0);
    const unallocatedFilmRevenueCents = [...movies.values()].reduce((sum, movie) => sum + movie.unallocatedRevenueCents, 0);
    const combinedRevenueCents = ticketCollectedCents + fnbRevenueCents;
    return {
      range, totals: { grossRevenueCents: ticketCollectedCents + ticketRefundedCents + fnbRevenueCents + fnbRefundedCents, refundedCents: ticketRefundedCents + fnbRefundedCents, ticketRefundedCents, fnbRefundedCents, ticketRevenueCents, ticketFeesCents, ticketTaxCents, ticketCollectedCents, distributorRevenueCents, cinemaFilmRevenueCents, unallocatedFilmRevenueCents, fnbRevenueCents, combinedRevenueCents, ticketsSold, fnbOrders: fnbOrderCount, averageFnbSpendPerOrderCents: fnbOrderCount ? Math.round(fnbRevenueCents / fnbOrderCount) : 0, averageFnbSpendPerSeatCents: fnbSeatCount ? Math.round(fnbRevenueCents / fnbSeatCount) : 0, averageTotalSpendPerPatronCents: ticketsSold ? Math.round(combinedRevenueCents / ticketsSold) : 0, concessionAttachRatePercent: ticketsSold ? Math.min(100, Math.round((fnbSeatCount / ticketsSold) * 1000) / 10) : 0 },
      movies: [...movies.values()].sort((a, b) => a.title.localeCompare(b.title)),
      showtimes: [...showtimes.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      admissionTypes: [...admissionTypes.values()].sort((a, b) => b.ticketsSold - a.ticketsSold || a.name.localeCompare(b.name)),
      salesChannels: [...salesChannels.values()].sort((a, b) => b.ticketsSold - a.ticketsSold || a.channel.localeCompare(b.channel)),
      ticketFeeDetails: ticketOrders
        .filter((order) => order.status !== "REFUNDED" && order.feesCents > 0 && order.tickets.length > 0)
        .map((order) => ({ orderId: order.id, orderNumber: order.orderNumber, createdAt: order.createdAt, channel: order.channel, ticketsSold: order.tickets.length, ticketFeesCents: order.feesCents, averageFeeCents: Math.round(order.feesCents / order.tickets.length), movieTitles: [...new Set(order.tickets.map((ticket) => ticket.showtimeSeat.showtime.movie.title))].sort() }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.orderNumber.localeCompare(b.orderNumber)),
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
      ["Distributor film share (cents)", report.totals.distributorRevenueCents], ["Cinema film share (cents)", report.totals.cinemaFilmRevenueCents],
      ["Unallocated film revenue (cents)", report.totals.unallocatedFilmRevenueCents],
      ["F&B revenue (cents)", report.totals.fnbRevenueCents], ["Tickets sold", report.totals.ticketsSold],
      ["F&B orders", report.totals.fnbOrders], ["Average F&B per order (cents)", report.totals.averageFnbSpendPerOrderCents],
      ["Average F&B per occupied seat (cents)", report.totals.averageFnbSpendPerSeatCents],
      ["Average total spend per patron (cents)", report.totals.averageTotalSpendPerPatronCents],
      ["Concession attach rate (percent)", report.totals.concessionAttachRatePercent],
    ];
    return [
      row(["Report from", report.range.from.toISOString()]), row(["Report to", report.range.to.toISOString()]),
      row(["Summary metric", "Value"]), ...totals.map(row), "",
      row(["Movie", "Distributor", "Tickets sold", "Ticket face value (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated (cents)", "F&B revenue (cents)"]),
      ...report.movies.map((movie) => row([movie.title, movie.distributorName, movie.ticketsSold, movie.ticketRevenueCents, movie.distributorRevenueCents, movie.cinemaRevenueCents, movie.unallocatedRevenueCents, movie.fnbRevenueCents])), "",
      row(["Showtime", "Starts at", "Tickets sold", "Ticket face value (cents)", "F&B revenue (cents)"]),
      ...report.showtimes.map((showtime) => row([showtime.title, showtime.startsAt.toISOString(), showtime.ticketsSold, showtime.ticketRevenueCents, showtime.fnbRevenueCents])), "",
      row(["Admission type", "Tickets sold", "Ticket face value (cents)"]),
      ...report.admissionTypes.map((ticketType) => row([ticketType.name, ticketType.ticketsSold, ticketType.ticketRevenueCents])), "",
      row(["Sales channel", "Tickets sold", "Ticket face value (cents)", "Ticket fees (cents)", "Average fee per ticket (cents)", "Gross collected (cents)", "Refunds (cents)", "Net collected (cents)"]),
      ...report.salesChannels.map((channel) => row([channel.channel, channel.ticketsSold, channel.ticketRevenueCents, channel.ticketFeesCents, channel.ticketsSold ? Math.round(channel.ticketFeesCents / channel.ticketsSold) : 0, channel.grossCollectedCents, channel.refundedCents, channel.netCollectedCents])),
      "", row(["Box-office operator", "Tickets sold", "Gross collected (cents)", "Refunds (cents)", "Net collected (cents)"]),
      ...report.salesOperators.map((operator) => row([operator.employeeName, operator.ticketsSold, operator.grossCollectedCents, operator.refundedCents, operator.netCollectedCents])),
      "", row(["Concession item", "Units sold", "Sales value (cents)"]),
      ...report.concessionTopSellers.map((item) => row([item.name, item.unitsSold, item.salesCents])),
      "", row(["Business date", "Tickets sold", "Ticket collected (cents)", "F&B revenue (cents)", "Net revenue (cents)", "Average total spend per patron (cents)"]),
      ...report.dailyPerformance.map((day) => row([day.date, day.ticketsSold, day.ticketCollectedCents, day.fnbRevenueCents, day.combinedRevenueCents, day.averageTotalSpendPerPatronCents])),
    ].join("\n");
  }

  moviePerformanceCsv(report: Awaited<ReturnType<ReportingService["moviePerformance"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    const sliceRows = (title: string, slices: typeof report.auditoriumPerformance) => [
      row([title]), row(["Segment", "Shows", "Tickets", "Capacity", "Attendance percent", "Average tickets per show", "Ticket revenue (cents)", "Average ticket revenue per show (cents)", "F&B revenue (cents)", "Average F&B per show (cents)"]),
      ...slices.map((slice) => row([slice.label, slice.showtimes, slice.ticketsSold, slice.capacity, slice.attendancePercent, slice.averageTicketsPerShow, slice.ticketRevenueCents, slice.averageTicketRevenuePerShowCents, slice.fnbRevenueCents, slice.averageFnbPerShowCents])), "",
    ];
    return [
      row(["Film performance", report.movie.title]), row(["Cinema", report.location.name]), row(["Report from", report.range?.from.toISOString() ?? "All time"]), row(["Report to", report.range?.to.toISOString() ?? "All time"]), "",
      row(["Summary metric", "Value"]), row(["Performances", report.totals.showtimes]), row(["Tickets sold", report.totals.ticketsSold]), row(["Capacity", report.totals.totalCapacity]), row(["Attendance percent", report.totals.attendancePercent]), row(["Ticket revenue (cents)", report.totals.ticketRevenueCents]), row(["F&B revenue (cents)", report.totals.fnbRevenueCents]), row(["Distributor share (cents)", report.totals.distributorRevenueCents]), row(["Cinema share (cents)", report.totals.cinemaRevenueCents]), row(["Discounts (cents)", report.totals.discountCents]), row(["Complimentary tickets", report.totals.complimentaryTickets]), row(["Refunded tickets", report.totals.refundedTickets]), row(["Refunded ticket value (cents)", report.totals.refundedTicketValueCents]), "",
      row(["Showtime detail"]), row(["Starts at", "Auditorium", "Series", "Theatrical week", "Tickets", "Capacity", "Ticket revenue (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)"]), ...report.showtimes.map((showtime) => row([showtime.startsAt.toISOString(), showtime.auditorium.name, showtime.filmSeries?.name, showtime.theatricalWeek, showtime.ticketsSold, showtime.capacity, showtime.ticketRevenueCents, showtime.fnbRevenueCents, showtime.distributorRevenueCents, showtime.cinemaRevenueCents])), "",
      row(["Weekly performance"]), row(["Theatrical week", "First showtime", "Last showtime", "Shows", "Tickets", "Capacity", "Attendance percent", "Ticket revenue (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)"]), ...report.weeklyPerformance.map((week) => row([week.theatricalWeek, week.firstShowtime.toISOString(), week.lastShowtime.toISOString(), week.showtimes, week.ticketsSold, week.capacity, week.attendancePercent, week.ticketRevenueCents, week.fnbRevenueCents, week.distributorRevenueCents, week.cinemaRevenueCents])), "",
      row(["Daily performance"]), row(["Cinema date", "Shows", "Tickets", "Capacity", "Attendance percent", "Ticket revenue (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)"]), ...report.dailyPerformance.map((day) => row([day.date, day.showtimes, day.ticketsSold, day.capacity, day.attendancePercent, day.ticketRevenueCents, day.fnbRevenueCents, day.distributorRevenueCents, day.cinemaRevenueCents])), "",
      row(["Admission types"]), row(["Type", "Tickets", "Ticket revenue (cents)"]), ...report.admissionTypes.map((type) => row([type.name, type.ticketsSold, type.ticketRevenueCents])), "", row(["Sales channels"]), row(["Channel", "Tickets", "Ticket revenue (cents)"]), ...report.salesChannels.map((channel) => row([channel.channel, channel.ticketsSold, channel.ticketRevenueCents])), "", row(["Promotions"]), row(["Code", "Name", "Type", "Orders", "Tickets", "Discount (cents)"]), ...report.promotions.map((promotion) => row([promotion.code, promotion.name, promotion.type, promotion.orders, promotion.tickets, promotion.discountCents])), "",
      row(["Food and drink items"]), row(["Item", "Category", "Units sold", "Ticket checkout units", "During-show units", "Item sales (cents)"]), ...report.fnbItems.map((item) => row([item.name, item.chargeCategory, item.unitsSold, item.orderAheadUnits, item.serviceUnits, item.salesCents])), "",
      ...sliceRows("Performance by auditorium", report.auditoriumPerformance), ...sliceRows("Performance by daypart", report.daypartPerformance), ...sliceRows("Performance by weekday", report.weekdayPerformance),
    ].join("\n");
  }

  filmSeriesPerformanceCsv(report: Awaited<ReturnType<ReportingService["filmSeriesPerformance"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    return [
      row(["Film series performance", report.series.name]), row(["Cinema", report.location.name]), row(["Report from", report.range?.from.toISOString() ?? "All time"]), row(["Report to", report.range?.to.toISOString() ?? "All time"]), "",
      row(["Summary metric", "Value"]), row(["Films", report.totals.uniqueFilms]), row(["Performances", report.totals.showtimes]), row(["Upcoming performances", report.totals.upcomingShowtimes]), row(["Past performances", report.totals.pastShowtimes]), row(["Tickets sold", report.totals.ticketsSold]), row(["Capacity", report.totals.totalCapacity]), row(["Attendance percent", report.totals.attendancePercent]), row(["Average tickets per show", report.totals.averageTicketsPerShow]), row(["Average ticket (cents)", report.totals.averageTicketCents]), row(["Ticket revenue (cents)", report.totals.ticketRevenueCents]), row(["F&B revenue (cents)", report.totals.fnbRevenueCents]), row(["Average F&B per show (cents)", report.totals.averageFnbPerShowCents]), row(["Distributor share (cents)", report.totals.distributorRevenueCents]), row(["Cinema share (cents)", report.totals.cinemaRevenueCents]), row(["Unallocated value (cents)", report.totals.unallocatedRevenueCents]), "",
      row(["Film performance"]), row(["Film", "Distributor", "Performances", "Tickets", "Capacity", "Attendance percent", "Ticket revenue (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated value (cents)"]), ...report.movies.map((movie) => row([movie.title, movie.distributorName, movie.showtimes, movie.ticketsSold, movie.totalCapacity, movie.attendancePercent, movie.ticketRevenueCents, movie.fnbRevenueCents, movie.distributorRevenueCents, movie.cinemaRevenueCents, movie.unallocatedRevenueCents])), "",
      row(["Showtime performance"]), row(["Starts at", "Film", "Auditorium", "Tickets", "Capacity", "Ticket revenue (cents)", "F&B revenue (cents)", "Distributor share rate (basis points)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated value (cents)"]), ...report.showtimes.map((showtime) => row([showtime.startsAt.toISOString(), showtime.movie.title, showtime.auditorium.name, showtime.ticketsSold, showtime.capacity, showtime.ticketRevenueCents, showtime.fnbRevenueCents, showtime.distributorShareBasisPoints, showtime.distributorRevenueCents, showtime.cinemaRevenueCents, showtime.unallocatedRevenueCents])),
    ].join("\n");
  }

  distributorPerformanceCsv(report: Awaited<ReturnType<ReportingService["distributorPerformance"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    const distributor = report.distributor;
    if (!distributor) return row(["Distributor performance", "No distributor found"]);
    return [
      row(["Distributor performance", distributor.name]), row(["Cinema", report.location.name]), row(["Report from", report.range?.from.toISOString() ?? "All time"]), row(["Report to", report.range?.to.toISOString() ?? "All time"]), "",
      row(["Summary metric", "Value"]), row(["Films", distributor.films.length]), row(["Performances", distributor.showtimes]), row(["Tickets sold", distributor.ticketsSold]), row(["Capacity", distributor.totalCapacity]), row(["Attendance percent", distributor.attendancePercent]), row(["Ticket face value (cents)", distributor.ticketRevenueCents]), row(["F&B revenue (cents)", distributor.fnbRevenueCents]), row(["Distributor share (cents)", distributor.distributorRevenueCents]), row(["Cinema share (cents)", distributor.cinemaRevenueCents]), row(["Unallocated value (cents)", distributor.unallocatedRevenueCents]), "",
      row(["Film and deal history"]), row(["Film", "Status", "First showtime", "Last showtime", "Performances", "Upcoming", "Past", "Tickets", "Capacity", "Attendance percent", "Ticket face value (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated value (cents)", "Deal terms"]),
      ...distributor.films.map((film) => row([film.title, film.dealStatus, film.firstShowtime?.toISOString(), film.lastShowtime?.toISOString(), film.showtimes, film.upcomingShowtimes, film.pastShowtimes, film.ticketsSold, film.totalCapacity, film.attendancePercent, film.ticketRevenueCents, film.fnbRevenueCents, film.distributorRevenueCents, film.cinemaRevenueCents, film.unallocatedRevenueCents, JSON.stringify(film.terms)])),
    ].join("\n");
  }

  distributorDirectoryCsv(report: Awaited<ReturnType<ReportingService["distributorPerformance"]>>) {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const row = (values: unknown[]) => values.map(quote).join(",");
    return [
      row(["Distributor directory", report.location.name]), row(["Report from", report.range?.from.toISOString() ?? "All time"]), row(["Report to", report.range?.to.toISOString() ?? "All time"]), "",
      row(["Distributor", "Films", "Performances", "Tickets", "Capacity", "Attendance percent", "Ticket face value (cents)", "F&B revenue (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated value (cents)"]),
      ...report.distributors.map((distributor) => row([distributor.name, distributor.films.length, distributor.showtimes, distributor.ticketsSold, distributor.totalCapacity, distributor.attendancePercent, distributor.ticketRevenueCents, distributor.fnbRevenueCents, distributor.distributorRevenueCents, distributor.cinemaRevenueCents, distributor.unallocatedRevenueCents])),
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
      row(["Film", "Distributor", "Paid admissions", "Ticket face value (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated (cents)", "Allocation status"]),
      ...report.movies.map((movie) => row([movie.title, movie.distributorName, movie.ticketsSold, movie.ticketRevenueCents, movie.distributorRevenueCents, movie.cinemaRevenueCents, movie.unallocatedRevenueCents, movie.allocationComplete ? "Allocated" : "Terms needed"])),
      "",
      row(["Showtime detail"]),
      row(["Film", "Distributor", "Showtime", "Theatrical week", "Distributor share rate (basis points)", "Paid admissions", "Ticket face value (cents)", "Distributor share (cents)", "Cinema share (cents)", "Unallocated (cents)"]),
      ...report.showtimes.map((showtime) => row([showtime.title, showtime.distributorName, showtime.startsAt.toISOString(), showtime.theatricalWeek, showtime.distributorShareBasisPoints, showtime.ticketsSold, showtime.ticketRevenueCents, showtime.distributorRevenueCents, showtime.cinemaRevenueCents, showtime.unallocatedRevenueCents])),
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
