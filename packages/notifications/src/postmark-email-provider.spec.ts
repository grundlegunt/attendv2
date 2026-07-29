import { PostmarkEmailProvider } from "./postmark-email-provider";

describe("PostmarkEmailProvider", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends each signed ticket as an inline QR attachment", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "message-1", ErrorCode: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new PostmarkEmailProvider("POSTMARK_API_TEST", "receipts@example.com");

    await expect(
      provider.sendTicketReceipt({
        to: "guest@example.com",
        guestName: "Guest",
        orderNumber: "AT-TEST",
        totalCents: 1250,
        currency: "USD",
        tickets: [{
          id: "ticket-1",
          credential: "v1.signed-credential",
          movie: "Test Movie",
          auditorium: "Screen 1",
          seat: "A1",
          startsAt: new Date("2026-07-29T19:00:00.000Z"),
        }],
      }),
    ).resolves.toEqual({ messageId: "message-1" });

    const request = fetchMock.mock.calls[0]!;
    expect(request[0]).toBe("https://api.postmarkapp.com/email");
    const body = JSON.parse((request[1] as RequestInit).body as string);
    expect(body.To).toBe("guest@example.com");
    expect(body.Attachments).toEqual([
      expect.objectContaining({
        Name: "ticket-1.png",
        ContentType: "image/png",
        ContentID: "cid:ticket-ticket-1",
        Content: expect.any(String),
      }),
    ]);
  });

  it("rejects a provider error instead of claiming delivery", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 10, Message: "Sender not allowed" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new PostmarkEmailProvider("POSTMARK_API_TEST", "receipts@example.com");

    await expect(
      provider.sendTicketReceipt({
        to: "guest@example.com",
        orderNumber: "AT-TEST",
        totalCents: 1250,
        currency: "USD",
        tickets: [],
      }),
    ).rejects.toThrow("Sender not allowed");
  });
});
