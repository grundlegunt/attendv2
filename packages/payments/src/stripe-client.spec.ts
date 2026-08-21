import {
  createStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_TIMEOUT_MS,
} from "./stripe-client";

describe("Stripe client configuration", () => {
  it("bounds provider calls within the checkout request window", () => {
    const client = createStripeClient("sk_test_attend");
    const configured = client as unknown as {
      getApiField(name: string): unknown;
    };

    expect(configured.getApiField("timeout")).toBe(STRIPE_REQUEST_TIMEOUT_MS);
    expect(configured.getApiField("maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);
    expect(STRIPE_REQUEST_TIMEOUT_MS).toBe(8_000);
    expect(STRIPE_MAX_NETWORK_RETRIES).toBe(1);
  });
});
