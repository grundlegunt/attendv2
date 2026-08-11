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
