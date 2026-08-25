import type { SmsDeliveryResult, SmsMessage, SmsProvider } from "./sms-provider";

export class DisabledSmsProvider implements SmsProvider {
  async send(_message: SmsMessage): Promise<SmsDeliveryResult> {
    return { status: "disabled" };
  }
}

