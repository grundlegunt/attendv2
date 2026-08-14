import { ReportingService } from "./reporting.service";

describe("ReportingService distributor box-office export", () => {
  it("exports paid admissions and ticket face value without fees, tax, or F&B", () => {
    const service = new ReportingService();
    const report = {
      range: { from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-08T00:00:00.000Z") },
      totals: {
        grossRevenueCents: 2066, refundedCents: 0, ticketRefundedCents: 0, fnbRefundedCents: 0,
        ticketRevenueCents: 1700, ticketFeesCents: 200, ticketTaxCents: 166, ticketCollectedCents: 2066,
        fnbRevenueCents: 1400, combinedRevenueCents: 3466, ticketsSold: 1, fnbOrders: 1,
        averageFnbSpendPerOrderCents: 1400, averageFnbSpendPerSeatCents: 1400,
      },
      movies: [{ movieId: "movie-1", title: 'Film, "One"', ticketRevenueCents: 1700, ticketsSold: 1, fnbRevenueCents: 1400 }],
      showtimes: [{ showtimeId: "show-1", movieId: "movie-1", title: 'Film, "One"', startsAt: new Date("2026-08-05T18:00:00.000Z"), ticketRevenueCents: 1700, ticketsSold: 1, fnbRevenueCents: 1400 }],
    };

    const csv = service.distributorBoxOfficeCsv(report);

    expect(csv).toContain('"Film, ""One""","1","1700"');
    expect(csv).toContain('"2026-08-05T18:00:00.000Z"');
    expect(csv).not.toContain("2066");
    expect(csv).not.toContain("1400");
  });
});
