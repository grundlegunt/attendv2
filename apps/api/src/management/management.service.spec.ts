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
