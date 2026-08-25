import { TwilioSmsProvider } from "./twilio-sms-provider";

describe("TwilioSmsProvider", () => {
  it("sends an encoded message and returns the provider id", async () => {
    const request = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "SM123" }),
    });
    const provider = new TwilioSmsProvider("AC123", "secret", "+15550000000", request);

    await expect(provider.send({
      to: "+15551112222",
      body: "Your tickets are ready.",
      consent: { grantedAt: new Date("2026-08-25T12:00:00Z"), source: "customer_checkout" },
    })).resolves.toEqual({ status: "sent", messageId: "SM123" });

    const [url, options] = request.mock.calls[0];
    expect(url).toContain("/Accounts/AC123/Messages.json");
    expect(options.body.toString()).toBe("To=%2B15551112222&From=%2B15550000000&Body=Your+tickets+are+ready.");
  });

  it("does not expose the provider response body when delivery fails", async () => {
    const request = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const provider = new TwilioSmsProvider("AC123", "secret", "+15550000000", request);

    await expect(provider.send({
      to: "+15551112222",
      body: "Your tickets are ready.",
      consent: { grantedAt: new Date(), source: "customer_checkout" },
    })).rejects.toThrow("status 401");
  });
});

