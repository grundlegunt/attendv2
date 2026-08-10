import Stripe from "stripe";

export type ConnectedAccountDomainRegistration = {
  connectedAccountId: string;
  domains: string[];
};

/**
 * Registers Stripe Elements hostnames for Connect direct charges. Stripe
 * scopes PaymentMethodDomain objects to the account that owns the charge,
 * so platform-level Dashboard registrations are insufficient here.
 */
export async function registerConnectedAccountPaymentMethodDomains(
  secretKey: string,
  registrations: ConnectedAccountDomainRegistration[],
  stripeClient?: Stripe,
): Promise<number> {
  const stripe = stripeClient ?? new Stripe(secretKey, {
    apiVersion: "2024-11-20.acacia" as Stripe.LatestApiVersion,
  });
  let created = 0;

  for (const registration of registrations) {
    const requestOptions = { stripeAccount: registration.connectedAccountId };
    const existing = await stripe.paymentMethodDomains.list(
      { limit: 100 },
      requestOptions,
    );
    const registered = new Set(existing.data.map((item) => item.domain_name));

    for (const domain of registration.domains) {
      if (registered.has(domain)) continue;
      await stripe.paymentMethodDomains.create(
        { domain_name: domain },
        requestOptions,
      );
      registered.add(domain);
      created += 1;
    }
  }

  return created;
}
