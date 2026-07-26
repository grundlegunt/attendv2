import { prisma } from "@cinema/database";
import { StripePaymentProvider } from "@cinema/payments";
import { TicketingError, TicketingService } from "@cinema/ticketing";

export class CheckoutRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function getTicketingService() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    throw new CheckoutRouteError(
      503,
      "PAYMENT_CONFIGURATION_REQUIRED",
      "Stripe test payments have not been connected to this preview yet.",
    );
  }
  return new TicketingService(
    prisma,
    new StripePaymentProvider(secretKey, webhookSecret),
  );
}

export function checkoutRouteError(error: unknown) {
  if (error instanceof CheckoutRouteError) return error;
  if (error instanceof TicketingError) {
    return new CheckoutRouteError(error.status, error.code, error.message);
  }
  return null;
}
