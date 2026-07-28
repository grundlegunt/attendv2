/**
 * PaymentProvider — the only interface anything outside this package should
 * use to talk to a payment processor. `StripePaymentProvider` is the real
 * implementation; `TestPaymentProvider` is a deterministic double for tests.
 *
 * Every method takes an explicit `connectedAccountId` (undefined when the
 * organization has no Stripe Connect account routed yet) so multi-tenant
 * payment routing stays centralized in one place.
 *
 * Status values returned here (`ProviderPaymentStatus`, `ProviderRefundStatus`)
 * are already normalized/friendly — the provider implementation is
 * responsible for translating whatever the real processor's raw status
 * strings are into these; @cinema/ticketing never sees a raw Stripe status.
 */

export type ProviderPaymentStatus =
  | "REQUIRES_PAYMENT_METHOD"
  | "REQUIRES_ACTION"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type ProviderRefundStatus = "SUCCEEDED" | "PENDING" | "FAILED";

export interface CreatePaymentIntentArgs {
  connectedAccountId?: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface RetrievePaymentIntentArgs {
  connectedAccountId?: string;
  paymentIntentId: string;
}

export interface ProviderPaymentIntentResult {
  id: string;
  status: ProviderPaymentStatus;
  clientSecret?: string;
  amountCents: number;
  currency: string;
  // Round 2 follow-up: needed so finalizeOrder can verify the confirmed
  // charge's amount/currency/metadata actually match the order it's about
  // to issue tickets for, not just trust `status === "SUCCEEDED"` alone.
  metadata: Record<string, string>;
  failureCode?: string;
  failureMessage?: string;
}

export interface RefundArgs {
  connectedAccountId?: string;
  providerPaymentId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  // Round 2 follow-up: lets the async refund.updated webhook correlate a
  // later Stripe-side status change straight back to our own Refund row,
  // without depending on providerRefundId having already been persisted
  // locally (see TicketingService's refund reconciliation).
  metadata?: Record<string, string>;
}

export interface RetrieveRefundArgs {
  connectedAccountId?: string;
  providerRefundId: string;
}

export interface RefundResult {
  id: string;
  status: ProviderRefundStatus;
  failureMessage?: string;
}

export interface VerifyWebhookArgs {
  rawBody: Buffer;
  signatureHeader: string;
}

export type ProviderEventType =
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed"
  | "payment_intent.requires_action"
  | "refund.updated"
  | (string & {});

export interface VerifiedRefundEventData {
  providerRefundId: string;
  status: ProviderRefundStatus;
  metadata: Record<string, string>;
}

export interface VerifiedProviderEvent {
  id: string;
  type: ProviderEventType;
  // Present for payment_intent.* events.
  paymentIntentId?: string;
  // Round 2 follow-up: metadata from the underlying PaymentIntent, needed
  // to reconstruct a missing local Payment/PaymentAttempt row when the
  // process crashed before ever persisting providerPaymentId (see
  // TicketingService.processVerifiedWebhook) -- looked up by
  // metadata.ticketOrderId rather than depending on our own database
  // already having recorded the link.
  metadata?: Record<string, string>;
  // Present for refund.updated events.
  refund?: VerifiedRefundEventData;
}

/**
 * Round 2 follow-up: thrown by a PaymentProvider implementation ONLY when
 * the processor gave a definitive, confirmed rejection of a request (e.g.
 * Stripe's own `StripeInvalidRequestError` for a refund it positively
 * refused — already refunded, amount exceeds what's refundable). This
 * means retrying, even with the same idempotency key, will never succeed.
 *
 * Any OTHER failure — a network error, a timeout, a 5xx from the
 * processor's own servers, a rate limit, anything the implementation
 * cannot positively confirm was a rejection — must NOT throw this class.
 * The true outcome in those cases is UNKNOWN: the processor may have
 * already completed the operation before the response was lost in
 * transit, which is exactly the scenario idempotency keys exist to make
 * safe to retry. TicketingService treats a ProviderDefinitiveError as a
 * genuine terminal failure and anything else as "not yet known, retry
 * later" — conflating the two would let a transient network blip get
 * recorded as a definitively failed refund that may have actually
 * succeeded on the processor's side.
 */
export class ProviderDefinitiveError extends Error {}

export interface PaymentProvider {
  readonly name: string;
  createPaymentIntent(args: CreatePaymentIntentArgs): Promise<ProviderPaymentIntentResult>;
  retrievePaymentIntent(args: RetrievePaymentIntentArgs): Promise<ProviderPaymentIntentResult>;
  refund(args: RefundArgs): Promise<RefundResult>;
  /**
   * Round 2 follow-up: a Stripe idempotency-key replay of refunds.create
   * returns the response cached from the ORIGINAL call, not the refund's
   * current live status -- so it cannot be used to observe an async
   * pending -> succeeded/failed transition that happened after creation.
   * This fetches the live object instead. Used by the refund
   * reconciliation job when a refund's providerRefundId is already known
   * but its status is still unresolved.
   */
  retrieveRefund(args: RetrieveRefundArgs): Promise<RefundResult>;
  /**
   * Verifies the signature header against the RAW request body before any
   * business logic runs. Throws if the signature is invalid.
   */
  verifyWebhookSignature(args: VerifyWebhookArgs): VerifiedProviderEvent;
}
