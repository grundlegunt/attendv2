import Stripe from "stripe";

export const STRIPE_REQUEST_TIMEOUT_MS = 8_000;
export const STRIPE_MAX_NETWORK_RETRIES = 1;

export function createStripeClient(secretKey: string) {
  return new Stripe(secretKey, {
    apiVersion: "2024-11-20.acacia" as Stripe.LatestApiVersion,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
  });
}
