import { PostmarkEmailProvider } from "./postmark-email-provider";

jest.mock("qrcode", () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,cXItcG5n"),
  },
}));

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
        orderAhead: {
          subtotalCents: 900,
          taxCents: 90,
          serviceChargeCents: 10,
          items: [{ name: "Shoestring Fries", quantity: 1, totalCents: 900 }],
        },
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
    expect(body.HtmlBody).toContain("Order ahead");
    expect(body.HtmlBody).toContain("Shoestring Fries");
    expect(body.TextBody).toContain("Service charge: $0.10");
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

  it("sends a restaurant payment failure notice with a recovery link", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "message-2", ErrorCode: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new PostmarkEmailProvider(
      "POSTMARK_API_TEST",
      "receipts@example.com",
    );

    await expect(
      provider.sendRestaurantPaymentFailed({
        to: "guest@example.com",
        customerName: "Guest",
        theaterName: "Meridian Cinema",
        tabId: "tab-1",
        amountDueCents: 2066,
        currency: "USD",
        paymentUrl: "https://cinema.example/account/tabs/tab-1",
      }),
    ).resolves.toEqual({ messageId: "message-2" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      To: "guest@example.com",
      Subject: "Action needed for your Meridian Cinema dining tab",
    });
    expect(body.HtmlBody).toContain(
      "https://cinema.example/account/tabs/tab-1",
    );
    expect(body.TextBody).toContain("$20.66");
  });

  it("sends an itemized restaurant receipt", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "message-3", ErrorCode: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new PostmarkEmailProvider(
      "POSTMARK_API_TEST",
      "receipts@example.com",
    );

    await expect(
      provider.sendRestaurantReceipt({
        to: "guest@example.com",
        customerName: "Guest",
        theaterName: "Meridian Cinema",
        receiptNumber: "R-2026-TEST",
        subtotalCents: 1700,
        taxCents: 166,
        serviceChargeCents: 200,
        tipCents: 300,
        totalCents: 2366,
        currency: "USD",
        items: [{ name: "Old Fashioned", quantity: 2, totalCents: 1700 }],
      }),
    ).resolves.toEqual({ messageId: "message-3" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      To: "guest@example.com",
      Subject: "Your Meridian Cinema dining receipt",
    });
    expect(body.HtmlBody).toContain("R-2026-TEST");
    expect(body.HtmlBody).toContain("2× Old Fashioned — $17.00");
    expect(body.TextBody).toContain("Subtotal: $17.00");
    expect(body.TextBody).toContain("Service charge: $2.00");
    expect(body.TextBody).toContain("Total: $23.66");
  });

  it("rejects a failed restaurant receipt delivery", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ Message: "Mailbox unavailable" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new PostmarkEmailProvider(
      "POSTMARK_API_TEST",
      "receipts@example.com",
    );

    await expect(
      provider.sendRestaurantReceipt({
        to: "guest@example.com",
        theaterName: "Meridian Cinema",
        receiptNumber: "R-2026-TEST",
        subtotalCents: 1700,
        taxCents: 166,
        serviceChargeCents: 200,
        tipCents: 300,
        totalCents: 2366,
        currency: "USD",
        items: [],
      }),
    ).rejects.toThrow("Mailbox unavailable");
  });
});
