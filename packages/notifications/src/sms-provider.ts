export type SmsConsentSource = "customer_checkout" | "customer_account" | "staff_confirmed";

export interface SmsConsent {
  grantedAt: Date;
  source: SmsConsentSource;
}

export interface SmsMessage {
  to: string;
  body: string;
  consent: SmsConsent;
}

export type SmsDeliveryResult =
  | { status: "sent"; messageId: string }
  | { status: "disabled" };

/**
 * Provider-neutral SMS boundary. Requiring consent in every message makes it
 * difficult for a future call site to text a customer accidentally.
 */
export interface SmsProvider {
  send(message: SmsMessage): Promise<SmsDeliveryResult>;
}

