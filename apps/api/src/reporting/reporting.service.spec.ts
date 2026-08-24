import { ReportingService } from "./reporting.service";

describe("ReportingService ticket-checkout F&B", () => {
  it("classifies prepaid order-ahead totals as F&B and excludes them from later tab revenue", () => {
    const service = new ReportingService() as unknown as {
      orderAheadRevenue(order: { orderAheadSubtotalCents: number; orderAheadTaxCents: number; orderAheadServiceChargeCents: number }): number;
      tabRevenue(tab: { totalCents: number; prepaidCents: number; status: string; payments: Array<{ refunds: Array<{ amountCents: number }> }> }): { revenueCents: number; refundedCents: number };
    };
    expect(service.orderAheadRevenue({ orderAheadSubtotalCents: 1800, orderAheadTaxCents: 175, orderAheadServiceChargeCents: 225 })).toBe(2200);
    expect(service.tabRevenue({ totalCents: 2200, prepaidCents: 2200, status: "CLOSED", payments: [] })).toEqual({ revenueCents: 0, refundedCents: 0 });
    expect(service.tabRevenue({ totalCents: 3100, prepaidCents: 2200, status: "CLOSED", payments: [{ refunds: [{ amountCents: 300 }] }] })).toEqual({ revenueCents: 600, refundedCents: 300 });
  });
});

describe("ReportingService film advance sales", () => {
  it("groups purchases into stable booking-window buckets", () => {
    const service = new ReportingService() as unknown as {
      advanceSalesBucket(purchasedAt: Date, startsAt: Date): { key: string; label: string; order: number; hours: number };
    };
    const startsAt = new Date("2026-08-24T20:00:00.000Z");
    expect(service.advanceSalesBucket(new Date("2026-08-24T08:00:00.000Z"), startsAt).key).toBe("SAME_DAY");
    expect(service.advanceSalesBucket(new Date("2026-08-22T20:00:00.000Z"), startsAt).key).toBe("ONE_TO_THREE_DAYS");
    expect(service.advanceSalesBucket(new Date("2026-08-18T20:00:00.000Z"), startsAt).key).toBe("FOUR_TO_SEVEN_DAYS");
    expect(service.advanceSalesBucket(new Date("2026-08-12T20:00:00.000Z"), startsAt).key).toBe("EIGHT_TO_FOURTEEN_DAYS");
    expect(service.advanceSalesBucket(new Date("2026-08-01T20:00:00.000Z"), startsAt).key).toBe("FIFTEEN_PLUS_DAYS");
  });
});

describe("ReportingService film performance export", () => {
  it("includes item-level F&B sales and service channels", () => {
    const source = new ReportingService().moviePerformanceCsv.toString();
    expect(source).toContain("Food and drink items");
    expect(source).toContain("Ticket checkout units");
    expect(source).toContain("item.orderAheadUnits");
    expect(source).toContain("item.serviceUnits");
    expect(source).toContain("item.salesCents");
  });

  it("includes cinema-date performance", () => {
    const source = new ReportingService().moviePerformanceCsv.toString();
    expect(source).toContain("Daily performance");
    expect(source).toContain("Cinema date");
    expect(source).toContain("report.dailyPerformance.map");
  });
});

describe("ReportingService distributor performance export", () => {
  it("includes allocation totals, film history, and deal terms", () => {
    const source = new ReportingService().distributorPerformanceCsv.toString();
    expect(source).toContain("Film and deal history");
    expect(source).toContain("Distributor share (cents)");
    expect(source).toContain("film.dealStatus");
    expect(source).toContain("JSON.stringify(film.terms)");
  });
});

describe("ReportingService audience origins", () => {
  it("groups ZIP+4 orders by five-digit ZIP without exposing order details", () => {
    const service = new ReportingService();
    const report = service.summarizeAudienceOrigins([
      { zipCode: "60614-1234", _count: { tickets: 2 } },
      { zipCode: "60614", _count: { tickets: 1 } },
      { zipCode: "60657", _count: { tickets: 1 } },
      { zipCode: "not-a-zip", _count: { tickets: 2 } },
      { zipCode: null, _count: { tickets: 3 } },
    ]);

    expect(report.totals).toEqual({ completedOrders: 5, ordersWithZip: 3, ticketsWithZip: 4, coveragePercent: 60 });
    expect(report.origins).toEqual([
      { zipCode: "60614", orders: 2, tickets: 3, sharePercent: 75 },
      { zipCode: "60657", orders: 1, tickets: 1, sharePercent: 25 },
    ]);
  });
});

describe("ReportingService distributor box-office export", () => {
  it("allocates ticket face value by theatrical week and leaves missing terms unallocated", () => {
    const service = new ReportingService();
    const terms = [
      { startWeek: 1, endWeek: 2, distributorShareBasisPoints: 6000 },
      { startWeek: 3, endWeek: null, distributorShareBasisPoints: 4000 },
    ];

    expect(service.allocateDistributorShare(1701, new Date("2026-08-08T18:00:00.000Z"), new Date("2026-08-01T18:00:00.000Z"), terms)).toEqual({
      theatricalWeek: 2, distributorShareBasisPoints: 6000, distributorRevenueCents: 1021,
      cinemaRevenueCents: 680, unallocatedRevenueCents: 0, allocationComplete: true,
    });
    expect(service.allocateDistributorShare(1700, new Date("2026-08-05T18:00:00.000Z"), new Date("2026-08-01T18:00:00.000Z"), null)).toEqual({
      theatricalWeek: 1, distributorShareBasisPoints: null, distributorRevenueCents: 0,
      cinemaRevenueCents: 0, unallocatedRevenueCents: 1700, allocationComplete: false,
    });
  });

  it("exports film allocations without fees, tax, or F&B", () => {
    const service = new ReportingService();
    const report = {
      range: { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-08T00:00:00.000Z") },
      totals: {
        grossRevenueCents: 2066, refundedCents: 0, ticketRefundedCents: 0, fnbRefundedCents: 0,
        ticketRevenueCents: 1700, ticketFeesCents: 200, ticketTaxCents: 166, ticketCollectedCents: 2066,
        distributorRevenueCents: 1020, cinemaFilmRevenueCents: 680, unallocatedFilmRevenueCents: 0,
        fnbRevenueCents: 1400, combinedRevenueCents: 3466, ticketsSold: 1, fnbOrders: 1,
        averageFnbSpendPerOrderCents: 1400, averageFnbSpendPerSeatCents: 1400,
        averageTotalSpendPerPatronCents: 3466, concessionAttachRatePercent: 100,
      },
      movies: [{ movieId: "movie-1", title: 'Film, "One"', distributorName: "Studio One", ticketRevenueCents: 1700, ticketsSold: 1, fnbRevenueCents: 1400, distributorRevenueCents: 1020, cinemaRevenueCents: 680, unallocatedRevenueCents: 0, allocationComplete: true }],
      showtimes: [{ showtimeId: "show-1", movieId: "movie-1", title: 'Film, "One"', distributorName: "Studio One", startsAt: new Date("2026-08-05T18:00:00.000Z"), ticketRevenueCents: 1700, ticketsSold: 1, fnbRevenueCents: 1400, theatricalWeek: 1, distributorShareBasisPoints: 6000, distributorRevenueCents: 1020, cinemaRevenueCents: 680, unallocatedRevenueCents: 0, allocationComplete: true }],
      admissionTypes: [{ ticketTypeId: "adult", name: "Adult", ticketsSold: 1, ticketRevenueCents: 1700 }],
      salesChannels: [{ channel: "ONLINE", ticketsSold: 1, ticketRevenueCents: 1700, ticketFeesCents: 200, grossCollectedCents: 2066, refundedCents: 0, netCollectedCents: 2066 }],
      ticketFeeDetails: [],
      salesOperators: [],
      concessionTopSellers: [],
      dailyPerformance: [],
    };

    const csv = service.distributorBoxOfficeCsv(report);

    expect(csv).toContain('"Film, ""One""","Studio One","1","1700","1020","680","0","Allocated"');
    expect(csv).toContain('"2026-08-05T18:00:00.000Z"');
    expect(csv).not.toContain("2066");
    expect(csv).not.toContain("1400");
  });
});

describe("ReportingService expense export", () => {
  it("quotes accounting fields and preserves exact cents", () => {
    const service = new ReportingService();
    const csv = service.expensesCsv({
      range: { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-09-01T00:00:00.000Z") },
      totals: { totalExpenseCents: 12345, count: 1, byCategory: { FILM_RENTAL: 12345 } },
      rows: [{ id: "expense-1", locationId: "location-1", category: "FILM_RENTAL", vendor: 'Studio, "One"', description: "Film rental", amountCents: 12345, incurredAt: new Date("2026-08-15T12:00:00.000Z"), notes: "Week one", createdAt: new Date(), updatedAt: new Date() }],
    });

    expect(csv).toContain('"Studio, ""One"""');
    expect(csv).toContain('"12345"');
    expect(csv).toContain('"FILM_RENTAL"');
  });
});
