import { Module } from "@nestjs/common";
import {
  EmailProvider,
  PostmarkEmailProvider,
  TestEmailProvider,
} from "@cinema/notifications";
import { loadEnv } from "@cinema/config/env";

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

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
  ],
  exports: [EMAIL_PROVIDER],
})
export class NotificationsModule {}
