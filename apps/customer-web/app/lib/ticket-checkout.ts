import { prisma } from "@cinema/database";
import { StripePaymentProvider } from "@cinema/payments";
import { PostmarkEmailProvider } from "@cinema/notifications";
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
  const qrCredentialSecret = process.env.QR_CREDENTIAL_SECRET;
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  const emailFrom = process.env.EMAIL_FROM;
  if (
    !secretKey ||
    !webhookSecret ||
    !qrCredentialSecret ||
    qrCredentialSecret.length < 32 ||
    !postmarkToken ||
    !emailFrom
  ) {
    throw new CheckoutRouteError(
      503,
      "PAYMENT_CONFIGURATION_REQUIRED",
      "Stripe test payments have not been connected to this preview yet.",
    );
  }
  return new TicketingService(
    prisma,
    new StripePaymentProvider(secretKey, webhookSecret),
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
