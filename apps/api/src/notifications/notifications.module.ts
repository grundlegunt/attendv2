import { Module } from "@nestjs/common";
import {
  EmailProvider,
  PostmarkEmailProvider,
  TestEmailProvider,
  DisabledSmsProvider,
  SmsProvider,
  TestSmsProvider,
  TwilioSmsProvider,
} from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");

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
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER],
})
export class NotificationsModule {}
