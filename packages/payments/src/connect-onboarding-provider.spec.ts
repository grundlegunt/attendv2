import type Stripe from "stripe";
import { StripeConnectOnboardingProvider } from "./connect-onboarding-provider";

describe("StripeConnectOnboardingProvider", () => {
  it("creates an Express account with direct-charge capabilities and an idempotency key", async () => {
    const create = jest.fn().mockResolvedValue({ id: "acct_123" });
    const provider = new StripeConnectOnboardingProvider("sk_test_example", { accounts: { create } } as unknown as Stripe);

    await expect(provider.createAccount({ organizationId: "org_123", businessName: "Bluebird Cinema LLC", idempotencyKey: "connect-account:org_123" })).resolves.toEqual({ id: "acct_123" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "express",
      country: "US",
      business_type: "company",
      company: { name: "Bluebird Cinema LLC" },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { organizationId: "org_123" },
    }), { idempotencyKey: "connect-account:org_123" });
  });

  it("creates hosted onboarding links and maps authoritative account state", async () => {
    const createLink = jest.fn().mockResolvedValue({ url: "https://connect.stripe.test/setup" });
    const retrieve = jest.fn().mockResolvedValue({
      id: "acct_123", deleted: false, charges_enabled: false, payouts_enabled: false, details_submitted: true,
      requirements: { currently_due: ["company.tax_id"], disabled_reason: "requirements.past_due" },
    });
    const provider = new StripeConnectOnboardingProvider("sk_test_example", { accountLinks: { create: createLink }, accounts: { retrieve } } as unknown as Stripe);

    await expect(provider.createAccountLink({ accountId: "acct_123", refreshUrl: "https://master.test/refresh", returnUrl: "https://master.test/return" })).resolves.toEqual({ url: "https://connect.stripe.test/setup" });
    expect(createLink).toHaveBeenCalledWith({ account: "acct_123", refresh_url: "https://master.test/refresh", return_url: "https://master.test/return", type: "account_onboarding" });
    await expect(provider.retrieveAccount("acct_123")).resolves.toEqual({ id: "acct_123", chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true, currentlyDue: ["company.tax_id"], disabledReason: "requirements.past_due" });
  });
});
