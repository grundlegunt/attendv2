import { Module } from "@nestjs/common";
import {
  EmailProvider,
  PostmarkEmailProvider,
  TestEmailProvider,
  DisabledSmsProvider,
  SmsProvider,
  TestSmsProvider,
  TwilioSmsProvider,
  AppleWalletPassProvider,
  DisabledWalletPassProvider,
  GoogleWalletPassProvider,
  TestWalletPassProvider,
  WalletPassProvider,
} from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
export const APPLE_WALLET_PROVIDER = Symbol("APPLE_WALLET_PROVIDER");
export const GOOGLE_WALLET_PROVIDER = Symbol("GOOGLE_WALLET_PROVIDER");

@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: (): EmailProvider => {
        const env = loadEnv();
        if (env.EMAIL_PROVIDER === "test") return new TestEmailProvider();
        return new PostmarkEmailProvider(env.POSTMARK_SERVER_TOKEN!, env.EMAIL_FROM);
      },
    },
    {
      provide: SMS_PROVIDER,
      useFactory: (): SmsProvider => {
        const env = loadEnv();
        if (env.SMS_PROVIDER === "test") return new TestSmsProvider();
        if (env.SMS_PROVIDER === "twilio") {
          return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM!);
        }
        return new DisabledSmsProvider();
      },
    },
    {
      provide: APPLE_WALLET_PROVIDER,
      useFactory: (): WalletPassProvider => {
        const env = loadEnv();
        if (env.APPLE_WALLET_PROVIDER === "test") return new TestWalletPassProvider("apple");
        if (env.APPLE_WALLET_PROVIDER === "passkit") {
          return new AppleWalletPassProvider({
            teamIdentifier: env.APPLE_WALLET_TEAM_ID!,
            passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_ID!,
            organizationName: "Ringo Tickets",
            wwdrCertificate: Buffer.from(env.APPLE_WALLET_WWDR_CERTIFICATE_BASE64!, "base64"),
            signerCertificate: Buffer.from(env.APPLE_WALLET_CERTIFICATE_BASE64!, "base64"),
            signerKey: Buffer.from(env.APPLE_WALLET_PRIVATE_KEY_BASE64!, "base64"),
            signerKeyPassphrase: env.APPLE_WALLET_PRIVATE_KEY_PASSWORD,
            icon: Buffer.from(env.APPLE_WALLET_ICON_BASE64!, "base64"),
            ...(env.APPLE_WALLET_ICON_2X_BASE64 ? { icon2x: Buffer.from(env.APPLE_WALLET_ICON_2X_BASE64, "base64") } : {}),
          });
        }
        return new DisabledWalletPassProvider("apple");
      },
    },
    {
      provide: GOOGLE_WALLET_PROVIDER,
      useFactory: (): WalletPassProvider => {
        const env = loadEnv();
        if (env.GOOGLE_WALLET_PROVIDER === "test") return new TestWalletPassProvider("google");
        if (env.GOOGLE_WALLET_PROVIDER === "google") {
          return new GoogleWalletPassProvider({
            issuerId: env.GOOGLE_WALLET_ISSUER_ID!,
            serviceAccountEmail: env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL!,
            privateKey: env.GOOGLE_WALLET_PRIVATE_KEY!,
            origins: [new URL(env.CUSTOMER_WEB_URL).origin],
          });
        }
        return new DisabledWalletPassProvider("google");
      },
    },
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER, APPLE_WALLET_PROVIDER, GOOGLE_WALLET_PROVIDER],
})
export class NotificationsModule {}
