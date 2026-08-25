import type { SmsDeliveryResult, SmsMessage, SmsProvider } from "./sms-provider";

export class TestSmsProvider implements SmsProvider {
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SmsDeliveryResult> {
    this.sent.push(message);
    return { status: "sent", messageId: `test-sms-${this.sent.length}` };
  }
}

