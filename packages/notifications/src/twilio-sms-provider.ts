import type { SmsDeliveryResult, SmsMessage, SmsProvider } from "./sms-provider";

type Fetch = typeof fetch;

export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly request: Fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<SmsDeliveryResult> {
    if (!message.consent.grantedAt || !message.consent.source) {
      throw new Error("SMS delivery requires recorded customer consent.");
    }

    const body = new URLSearchParams({
      To: message.to,
      From: this.from,
      Body: message.body,
    });
    const response = await this.request(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      throw new Error(`SMS provider rejected delivery with status ${response.status}.`);
    }
    const result = await response.json() as { sid?: unknown };
    if (typeof result.sid !== "string" || !result.sid) {
      throw new Error("SMS provider returned an invalid delivery response.");
    }
    return { status: "sent", messageId: result.sid };
  }
}

