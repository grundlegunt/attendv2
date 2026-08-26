import { prisma } from "@cinema/database";
import { canonicalMembershipNumber, ManagementService } from "./management.service";

describe("membership identity", () => {
  it("uses one canonical value for case-insensitive Admin and POS lookup", () => {
    expect(canonicalMembershipNumber("  member-a17  ")).toBe("MEMBER-A17");
  });
});

describe("membership directory", () => {
  it("scopes records to the active organization and applies operator filters", async () => {
    const location = jest.spyOn(prisma.location, "findUniqueOrThrow").mockResolvedValue({ organizationId: "organization-1" } as never);
    const memberships = jest.spyOn(prisma.membership, "findMany").mockResolvedValue([]);
    try {
      await new ManagementService().memberships("location-1", { query: "Jane", status: "ACTIVE" });
      expect(location).toHaveBeenCalledWith({ where: { id: "location-1" }, select: { organizationId: true } });
      expect(memberships).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: "organization-1", status: "ACTIVE", OR: expect.any(Array) }),
        take: 500,
      }));
    } finally {
      location.mockRestore(); memberships.mockRestore();
    }
  });

  it("turns lifecycle totals into date-bounded renewal queues", async () => {
    const location = jest.spyOn(prisma.location, "findUniqueOrThrow").mockResolvedValue({ organizationId: "organization-1" } as never);
    const memberships = jest.spyOn(prisma.membership, "findMany").mockResolvedValue([]);
    const now = new Date("2026-08-26T12:00:00.000Z");
    try {
      await new ManagementService().memberships("location-1", { lifecycle: "EXPIRING" }, now);
      const expiresBefore = new Date("2026-09-25T12:00:00.000Z");
      expect(memberships).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "organization-1", status: "ACTIVE", expiresAt: { gt: now, lte: expiresBefore } }) }));
      await new ManagementService().memberships("location-1", { lifecycle: "LAPSED" }, now);
      expect(memberships).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "organization-1", OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] }) }));
    } finally { location.mockRestore(); memberships.mockRestore(); }
  });

  it("summarizes lifecycle and paid online enrollment data for the active organization", async () => {
    const location = jest.spyOn(prisma.location, "findUniqueOrThrow").mockResolvedValue({ organizationId: "organization-1", currency: "USD" } as never);
    const count = jest.spyOn(prisma.membership, "count").mockResolvedValueOnce(12).mockResolvedValueOnce(3).mockResolvedValueOnce(2).mockResolvedValueOnce(4);
    const aggregate = jest.spyOn(prisma.membershipCheckout, "aggregate").mockResolvedValue({ _sum: { amountCents: 15000 }, _count: { _all: 3 } } as never);
    try {
      const now = new Date("2026-08-25T12:00:00.000Z");
      await expect(new ManagementService().membershipSummary("location-1", now)).resolves.toEqual({ active: 12, expiringSoon: 3, lapsed: 2, recentEnrollments: 4, collectedAmountCents: 15000, paidEnrollments: 3, currency: "USD" });
      expect(count).toHaveBeenCalledTimes(4);
      expect(aggregate).toHaveBeenCalledWith({ where: { organizationId: "organization-1", status: "PAID" }, _sum: { amountCents: true }, _count: { _all: true } });
    } finally {
      location.mockRestore(); count.mockRestore(); aggregate.mockRestore();
    }
  });

  it("exports filtered membership records without allowing spreadsheet formulas", () => {
    const service = new ManagementService();
    const csv = service.membershipsCsv([{ id: "membership-1", membershipNumber: "MEM-1", tier: "Supporter", status: "ACTIVE", expiresAt: new Date("2027-08-25T00:00:00.000Z"), createdAt: new Date("2026-08-25T00:00:00.000Z"), updatedAt: new Date("2026-08-25T01:00:00.000Z"), plan: { id: "plan-1", name: "Annual" }, customer: { id: "customer-1", name: "=2+2", email: "member@example.com", phone: null } }]);
    expect(csv).toContain('"MEM-1","\'=2+2","member@example.com"');
    expect(csv).toContain('"Annual","Supporter","ACTIVE","2027-08-25T00:00:00.000Z"');
  });
});

describe("membership plans", () => {
  it("loads only the signed-in cinema organization's plan catalog", async () => {
    const location = jest.spyOn(prisma.location, "findUniqueOrThrow").mockResolvedValue({ organizationId: "organization-1" } as never);
    const plans = jest.spyOn(prisma.membershipPlan, "findMany").mockResolvedValue([]);
    try {
      await new ManagementService().membershipPlans("location-1");
      expect(plans).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "organization-1" }, include: { _count: { select: { memberships: true } } } }));
    } finally {
      location.mockRestore(); plans.mockRestore();
    }
  });
});

describe("donation reporting", () => {
  it("keeps exports location scoped and applies reporting filters", async () => {
    const rows = jest.spyOn(prisma.donation, "findMany").mockResolvedValue([]);
    try {
      const from = new Date("2026-01-01T00:00:00.000Z"); const to = new Date("2027-01-01T00:00:00.000Z");
      await new ManagementService().donationExportRows("location-1", { campaignId: "campaign-1", from, to });
      expect(rows).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "location-1", campaignId: "campaign-1", receivedAt: { gte: from, lt: to } }, take: 10_000 }));
    } finally { rows.mockRestore(); }
  });

  it("exports deductible values and neutralizes spreadsheet formulas", () => {
    const csv = new ManagementService().donationsCsv([{ receivedAt: new Date("2026-08-25T00:00:00.000Z"), status: "SETTLED", campaign: { name: "Annual fund" }, customer: null, donorName: "=2+2", donorEmail: "donor@example.com", paymentMethod: "CHECK", externalReference: "check-1", amountCents: 10000, taxDeductibleAmountCents: 7500, notes: "Thank you" }] as never);
    expect(csv).toContain('"Annual fund","\'=2+2","donor@example.com"');
    expect(csv).toContain('"10000","7500"');
  });
});

describe("ManagementService private-event inquiry export", () => {
  it("keeps inquiry searches location-scoped and applies the selected status", async () => {
    const findMany = jest.spyOn(prisma.privateEventInquiry, "findMany").mockResolvedValue([]);

    await new ManagementService().privateEventInquiries("location-1", { status: "BOOKED", query: "school" });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ locationId: "location-1", status: "BOOKED", OR: expect.any(Array) }),
    }));
    findMany.mockRestore();
  });

  it("produces spreadsheet-safe CSV rows with quotes, commas, and newlines escaped", () => {
    const createdAt = new Date("2026-08-10T18:00:00.000Z");
    const preferredDate = new Date("2026-09-12T00:00:00.000Z");
    const csv = new ManagementService().privateEventInquiriesCsv([{
      id: "inquiry-1",
      locationId: "location-1",
      name: 'Jo "JJ" Smith',
      email: "jo@example.com",
      phone: null,
      eventType: "Birthday, private screening",
      preferredDate,
      guestCount: 40,
      message: "First line\nSecond line",
      status: "NEW",
      createdAt,
      updatedAt: createdAt,
    }]);

    expect(csv).toContain('"Jo ""JJ"" Smith"');
    expect(csv).toContain('"Birthday, private screening"');
    expect(csv).toContain('"First line\nSecond line"');
    expect(csv).toContain('"2026-09-12T00:00:00.000Z"');
  });
});

describe("ManagementService global search", () => {
  it("scopes searchable records to the active location and organization", async () => {
    const location = jest.spyOn(prisma.location, "findUniqueOrThrow")
      .mockResolvedValue({ organizationId: "organization-1" } as never);
    const orders = jest.spyOn(prisma.ticketOrder, "findMany").mockResolvedValue([]);
    const customers = jest.spyOn(prisma.customer, "findMany").mockResolvedValue([]);
    const tickets = jest.spyOn(prisma.ticket, "findMany").mockResolvedValue([]);
    const giftCards = jest.spyOn(prisma.giftCard, "findMany").mockResolvedValue([]);

    try {
      await new ManagementService().globalSearch("location-1", "jane@example.com");

      expect(location).toHaveBeenCalledWith({
        where: { id: "location-1" },
        select: { organizationId: true },
      });
      expect(orders).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ locationId: "location-1" }),
      }));
      expect(customers).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ email: { contains: "jane@example.com", mode: "insensitive" } }, { phone: { contains: "jane@example.com" } }, { name: { contains: "jane@example.com", mode: "insensitive" } }, { memberships: { some: { organizationId: "organization-1", membershipNumber: { contains: "jane@example.com", mode: "insensitive" } } } }] },
            { OR: [{ ticketOrders: { some: { locationId: "location-1" } } }, { restaurantTabs: { some: { locationId: "location-1" } } }, { memberships: { some: { organizationId: "organization-1" } } }] },
          ]),
        }),
        select: expect.objectContaining({ memberships: { where: { organizationId: "organization-1" }, select: { membershipNumber: true, tier: true, status: true }, take: 1 } }),
      }));
      expect(giftCards).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: "organization-1" }),
      }));
      expect(tickets).not.toHaveBeenCalled();
    } finally {
      location.mockRestore();
      orders.mockRestore();
      customers.mockRestore();
      tickets.mockRestore();
      giftCards.mockRestore();
    }
  });
});

describe("ManagementService customer history", () => {
  it("returns only the active location's orders and summarizes completed spend", async () => {
    const findFirst = jest.spyOn(prisma.customer, "findFirst").mockResolvedValue({
      id: "customer-1", name: "Jane", email: "jane@example.com", phone: null, isGuest: false, createdAt: new Date(),
      memberships: [],
      ticketOrders: [
        { id: "order-1", orderNumber: "A1", status: "PAID", channel: "ONLINE", totalCents: 2400, currency: "USD", guestName: null, guestEmail: null, createdAt: new Date(), tickets: [{ id: "ticket-1" }, { id: "ticket-2" }] },
        { id: "order-2", orderNumber: "A2", status: "REFUNDED", channel: "ONLINE", totalCents: 1200, currency: "USD", guestName: null, guestEmail: null, createdAt: new Date(), tickets: [{ id: "ticket-3" }] },
      ],
      restaurantTabs: [
        { id: "tab-1", status: "CLOSED", totalCents: 3200, location: { currency: "USD" } },
        { id: "tab-2", status: "OPEN", totalCents: 900, location: { currency: "USD" } },
      ],
      donations: [{ id: "donation-1", status: "SETTLED", amountCents: 5000, taxDeductibleAmountCents: 5000, paymentMethod: "ONLINE", receivedAt: new Date(), location: { currency: "USD" } }],
    } as never);
    const orderCount = jest.spyOn(prisma.ticketOrder, "count").mockResolvedValue(72);
    const ticketCount = jest.spyOn(prisma.ticket, "count").mockResolvedValue(118);
    const ticketSpend = jest.spyOn(prisma.ticketOrder, "aggregate").mockResolvedValue({ _sum: { totalCents: 125_000 } } as never);
    const diningVisitCount = jest.spyOn(prisma.restaurantTab, "count").mockResolvedValue(64);
    const diningSpend = jest.spyOn(prisma.restaurantTab, "aggregate").mockResolvedValue({ _sum: { totalCents: 83_500 } } as never);
    const donationCount = jest.spyOn(prisma.donation, "count").mockResolvedValue(3);
    const firstGift = new Date("2025-12-01T12:00:00Z");
    const lastGift = new Date("2026-08-22T12:00:00Z");
    const donationSummary = jest.spyOn(prisma.donation, "aggregate").mockResolvedValue({ _count: { _all: 2 }, _sum: { amountCents: 15_000, taxDeductibleAmountCents: 12_500 }, _avg: { amountCents: 7500 }, _min: { receivedAt: firstGift }, _max: { receivedAt: lastGift } } as never);
    try {
      const customer = await new ManagementService().customer("location-1", "customer-1");
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: "customer-1",
          OR: [
            { ticketOrders: { some: { locationId: "location-1" } } },
            { restaurantTabs: { some: { locationId: "location-1" } } },
            { donations: { some: { locationId: "location-1" } } },
            { memberships: { some: { organization: { locations: { some: { id: "location-1" } } } } } },
          ],
        },
        select: expect.objectContaining({ ticketOrders: expect.objectContaining({ where: { locationId: "location-1" }, skip: 0, take: 50 }) }),
      }));
      expect(ticketSpend).toHaveBeenCalledWith({ where: { customerId: "customer-1", locationId: "location-1", status: { in: ["PAID", "EXCHANGED", "PARTIALLY_REFUNDED"] } }, _sum: { totalCents: true } });
      expect(diningSpend).toHaveBeenCalledWith({ where: { primaryCustomerId: "customer-1", locationId: "location-1", status: "CLOSED" }, _sum: { totalCents: true } });
      expect(donationSummary).toHaveBeenCalledWith({ where: { customerId: "customer-1", locationId: "location-1", status: "SETTLED" }, _count: { _all: true }, _sum: { amountCents: true, taxDeductibleAmountCents: true }, _avg: { amountCents: true }, _min: { receivedAt: true }, _max: { receivedAt: true } });
      expect(customer.summary).toEqual({ orderCount: 72, ticketCount: 118, lifetimeSpendCents: 125_000, currency: "USD", diningVisitCount: 64, diningSpendCents: 83_500, diningCurrency: "USD", donationCount: 2, donationAmountCents: 15_000, donationTaxDeductibleAmountCents: 12_500, donationAverageAmountCents: 7500, donationFirstReceivedAt: firstGift, donationLastReceivedAt: lastGift, donationCurrency: "USD", membershipPurchaseCount: 0, membershipSpendCents: 0, membershipCurrency: "USD" });
      expect(customer.membership).toBeNull();
      expect(customer.historyWindow).toEqual({ ticketOrdersShown: 2, ticketOrdersTotal: 72, diningVisitsShown: 2, diningVisitsTotal: 64, donationsShown: 1, donationsTotal: 3 });
    } finally {
      findFirst.mockRestore();
      orderCount.mockRestore();
      ticketCount.mockRestore();
      ticketSpend.mockRestore();
      diningVisitCount.mockRestore();
      diningSpend.mockRestore();
      donationCount.mockRestore();
      donationSummary.mockRestore();
    }
  });

  it("exports spreadsheet-safe ticket and dining rows", async () => {
    const customer = jest.spyOn(ManagementService.prototype, "customer").mockResolvedValue({
      id: "customer-1", name: "=Jane", email: "jane@example.com", phone: null, isGuest: false, createdAt: new Date(), summary: {} as never, historyWindow: {} as never,
      ticketOrders: [{ id: "order-1", orderNumber: "AT-1", status: "PAID", channel: "ONLINE", totalCents: 1200, currency: "USD", guestName: null, guestEmail: null, createdAt: new Date("2026-08-20T12:00:00Z"), tickets: [{ id: "ticket-1", status: "ISSUED", priceCentsPaid: 1200, ticketType: { name: "Standard" }, showtimeSeat: { seat: { label: "A1" }, showtime: { startsAt: new Date(), movie: { title: "Film, One" }, auditorium: { name: "Theater 1" } } } }] }],
      restaurantTabs: [{ id: "tab-1", label: "Bar", status: "CLOSED", fulfillmentMode: "COUNTER_PICKUP", totalCents: 900, prepaidCents: 0, openedAt: new Date("2026-08-21T12:00:00Z"), closedAt: new Date(), location: { currency: "USD" }, showtime: null, seats: [], orders: [{ items: [{ quantity: 1, menuItem: { name: "Popcorn" } }] }] }],
      donations: [{ id: "donation-1", status: "SETTLED", amountCents: 5000, taxDeductibleAmountCents: 5000, paymentMethod: "CHECK", externalReference: "check-1", receivedAt: new Date("2026-08-22T12:00:00Z"), campaign: { id: "campaign-1", name: "Annual fund" }, location: { currency: "USD" } }],
    } as never);
    try {
      const csv = await new ManagementService().customerHistoryCsv("location-1", "customer-1");
      expect(customer).toHaveBeenCalledWith("location-1", "customer-1", { ticketOffset: 0, diningOffset: 0, donationOffset: 0, pageSize: 10_000 });
      expect(csv).toContain('"Film, One"');
      expect(csv).toContain('"Donation","2026-08-22T12:00:00.000Z","check-1","SETTLED","Annual fund"');
      expect(csv).toContain('"\'=Jane"');
      expect(csv.indexOf('"Dining"')).toBeLessThan(csv.indexOf('"Ticket"'));
    } finally { customer.mockRestore(); }
  });
});

describe("ManagementService attention inbox", () => {
  it("queries only durable action states within the active location", async () => {
    const orders = jest.spyOn(prisma.ticketOrder, "findMany").mockResolvedValue([]);
    const tabs = jest.spyOn(prisma.restaurantTab, "findMany").mockResolvedValue([]);
    const refunds = jest.spyOn(prisma.refund, "findMany").mockResolvedValue([]);
    const inquiries = jest.spyOn(prisma.privateEventInquiry, "findMany").mockResolvedValue([]);

    try {
      await new ManagementService().attentionInbox("location-1");
      expect(orders).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "location-1", channel: "BOX_OFFICE", status: "PAYMENT_FAILED" } }));
      expect(tabs).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "location-1", status: { in: ["PAYMENT_FAILED", "MANAGER_REVIEW"] } } }));
      expect(refunds).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "FAILED", payment: { OR: [{ ticketOrder: { locationId: "location-1" } }, { restaurantTab: { locationId: "location-1" } }] } } }));
      expect(inquiries).toHaveBeenCalledWith(expect.objectContaining({ where: { locationId: "location-1", status: "NEW" } }));
    } finally {
      orders.mockRestore();
      tabs.mockRestore();
      refunds.mockRestore();
      inquiries.mockRestore();
    }
  });
});

describe("ManagementService bulk ticket pricing", () => {
  it("rejects empty and zero-value bulk adjustments before opening a transaction", async () => {
    const transaction = jest.spyOn(prisma, "$transaction");
    const base = { locationId: "location-1", employeeId: "employee-1", requestId: "11111111-1111-4111-8111-111111111111" };
    try {
      await expect(new ManagementService().bulkUpdatePriceTiers({ ...base, priceTierIds: [], adjustmentMinor: 100 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(new ManagementService().bulkUpdatePriceTiers({ ...base, priceTierIds: ["22222222-2222-4222-8222-222222222222"], adjustmentMinor: 0 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});
