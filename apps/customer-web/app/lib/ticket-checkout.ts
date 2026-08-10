import { prisma } from "@cinema/database";
import { StripePaymentProvider } from "@cinema/payments";
import { PostmarkEmailProvider } from "@cinema/notifications";
import { TicketingError, TicketingService } from "@cinema/ticketing";
import { loadStripeEnv } from "@cinema/config/env";

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
  let stripe: ReturnType<typeof loadStripeEnv>;
  try { stripe = loadStripeEnv(); } catch {
    throw new CheckoutRouteError(503, "PAYMENT_CONFIGURATION_REQUIRED", "Stripe payments have not been configured for this environment.");
  }
  const qrCredentialSecret = process.env.QR_CREDENTIAL_SECRET;
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  const emailFrom = process.env.EMAIL_FROM;
  if (
    !qrCredentialSecret ||
    qrCredentialSecret.length < 32 ||
    !postmarkToken ||
    !emailFrom
  ) {
    throw new CheckoutRouteError(
      503,
      "PAYMENT_CONFIGURATION_REQUIRED",
      "Payments have not been connected to this environment yet.",
    );
  }
  return new TicketingService(
    prisma,
    new StripePaymentProvider(stripe.STRIPE_SECRET_KEY, stripe.STRIPE_WEBHOOK_SECRET),
    qrCredentialSecret,
    new PostmarkEmailProvider(postmarkToken, emailFrom),
  );
}

export function checkoutRouteError(error: unknown) {
  if (error instanceof CheckoutRouteError) return error;
  if (error instanceof TicketingError) {
    return new CheckoutRouteError(error.status, error.code, error.message);
  }
  return null;
}
