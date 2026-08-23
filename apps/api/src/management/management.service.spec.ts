import { prisma } from "@cinema/database";
import { ManagementService } from "./management.service";

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
          ticketOrders: { some: { locationId: "location-1" } },
        }),
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
      ticketOrders: [
        { id: "order-1", orderNumber: "A1", status: "PAID", channel: "ONLINE", totalCents: 2400, currency: "USD", guestName: null, guestEmail: null, createdAt: new Date(), tickets: [{ id: "ticket-1" }, { id: "ticket-2" }] },
        { id: "order-2", orderNumber: "A2", status: "REFUNDED", channel: "ONLINE", totalCents: 1200, currency: "USD", guestName: null, guestEmail: null, createdAt: new Date(), tickets: [{ id: "ticket-3" }] },
      ],
    } as never);
    try {
      const customer = await new ManagementService().customer("location-1", "customer-1");
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "customer-1", ticketOrders: { some: { locationId: "location-1" } } },
        select: expect.objectContaining({ ticketOrders: expect.objectContaining({ where: { locationId: "location-1" }, take: 50 }) }),
      }));
      expect(customer.summary).toEqual({ orderCount: 2, ticketCount: 3, lifetimeSpendCents: 2400, currency: "USD" });
    } finally {
      findFirst.mockRestore();
    }
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
