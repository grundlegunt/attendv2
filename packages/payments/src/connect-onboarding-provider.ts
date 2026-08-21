import Stripe from "stripe";
import { createStripeClient } from "./stripe-client";

export type ConnectAccountState = {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDue: string[];
  disabledReason: string | null;
};

export interface ConnectOnboardingProvider {
  createAccount(input: {
    organizationId: string;
    businessName: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  retrieveAccount(accountId: string): Promise<ConnectAccountState>;
}

export class StripeConnectOnboardingProvider implements ConnectOnboardingProvider {
  private readonly client: Stripe;

  constructor(secretKey: string, stripeClient?: Stripe) {
    if (!secretKey) throw new Error("StripeConnectOnboardingProvider requires a secretKey.");
    this.client = stripeClient ?? createStripeClient(secretKey);
  }

  async createAccount(input: { organizationId: string; businessName: string; idempotencyKey: string }) {
    const account = await this.client.accounts.create({
      type: "express",
      country: "US",
      business_type: "company",
      company: { name: input.businessName },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { organizationId: input.organizationId },
    }, { idempotencyKey: input.idempotencyKey });
    return { id: account.id };
  }

  async createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }) {
    const link = await this.client.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url };
  }

  async retrieveAccount(accountId: string): Promise<ConnectAccountState> {
    const account = await this.client.accounts.retrieve(accountId);
    if (account.deleted) throw new Error(`Stripe connected account ${accountId} was deleted.`);
    return {
      id: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      currentlyDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }
}
