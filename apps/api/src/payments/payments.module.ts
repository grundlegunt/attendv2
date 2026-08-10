import { Module } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import {
  PaymentProvider,
  StripePaymentProvider,
  TestPaymentProvider,
} from "@cinema/payments";
import { PaymentMethodDomainRegistrationService } from "./payment-method-domain-registration.service";

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

@Module({
  providers: [
    PaymentMethodDomainRegistrationService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (): PaymentProvider => {
        const env = loadEnv();
        if (env.PAYMENT_PROVIDER === "test") {
          return new TestPaymentProvider();
        }
        return new StripePaymentProvider(
          env.STRIPE_SECRET_KEY!,
          env.STRIPE_WEBHOOK_SECRET!,
        );
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
