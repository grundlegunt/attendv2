import { Module } from "@nestjs/common";
import { loadEnv } from "@cinema/config/env";
import { ConnectOnboardingProvider, StripeConnectOnboardingProvider } from "@cinema/payments";

export const CONNECT_ONBOARDING_PROVIDER = Symbol("CONNECT_ONBOARDING_PROVIDER");

@Module({
  providers: [{
    provide: CONNECT_ONBOARDING_PROVIDER,
    useFactory: (): ConnectOnboardingProvider => {
      const env = loadEnv();
      if (env.PAYMENT_PROVIDER === "test") {
        return {
          createAccount: async (input) => ({ id: `acct_test_${input.organizationId}` }),
          createAccountLink: async (input) => ({ url: `${input.returnUrl}&test_onboarding=1` }),
          retrieveAccount: async (accountId) => ({ id: accountId, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, currentlyDue: [], disabledReason: null }),
        };
      }
      return new StripeConnectOnboardingProvider(env.STRIPE_SECRET_KEY!);
    },
  }],
  exports: [CONNECT_ONBOARDING_PROVIDER],
})
export class ConnectOnboardingModule {}
