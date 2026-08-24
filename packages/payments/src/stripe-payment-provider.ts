import Stripe from "stripe";
import { createStripeClient } from "./stripe-client";
import {
  ProviderDefinitiveError,
  type CreatePaymentIntentArgs,
  type CreateProviderCustomerArgs,
  type ChargeSavedPaymentMethodArgs,
  type CollectCardPresentPaymentArgs,
  type PaymentProvider,
  type ProviderPaymentIntentResult,
  type ProviderPaymentStatus,
  type ProviderRefundStatus,
  type RefundArgs,
  type RefundResult,
  type RetrievePaymentIntentArgs,
  type RetrieveRefundArgs,
  type VerifiedProviderEvent,
  type VerifyWebhookArgs,
} from "./payment-provider";

/**
 * The real PaymentProvider implementation, backed by the Stripe SDK. Uses
 * Stripe Connect "direct charge" semantics (the `stripeAccount` request
 * option) so a PaymentIntent created for an organization with a completed
 * Connect account is created directly on that connected account — funds
 * settle to the theater's own bank account, not the platform's.
 *
 * `stripeClient` is an internal testability seam, not a production
 * parameter — every real caller constructs this with just
 * (secretKey, webhookSecret). It lets stripe-payment-provider.spec.ts
 * unit-test this file's own error-classification/reconciliation logic
 * against a controlled fake Stripe SDK client, without needing real
 * network access or test-mode Stripe keys.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly client: Stripe;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    stripeClient?: Stripe,
  ) {
    if (!secretKey) throw new Error("StripePaymentProvider requires a secretKey.");
    if (!webhookSecret) throw new Error("StripePaymentProvider requires a webhookSecret.");
    this.client = stripeClient ?? createStripeClient(secretKey);
  }

  async createCustomer(args: CreateProviderCustomerArgs) {
    const customer = await this.client.customers.create(
      { email: args.email, name: args.name, metadata: args.metadata },
      {
        idempotencyKey: args.idempotencyKey,
        ...(args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : {}),
      },
    );
    return { id: customer.id };
  }

  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<ProviderPaymentIntentResult> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: args.amountCents,
        currency: args.currency,
        metadata: args.metadata,
        automatic_payment_methods: { enabled: true },
        ...(args.providerCustomerId ? { customer: args.providerCustomerId } : {}),
        ...(args.savePaymentMethodForFuture ? { setup_future_usage: "off_session" as const } : {}),
      },
      {
        idempotencyKey: args.idempotencyKey,
        ...(args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : {}),
      },
    );
    return mapPaymentIntent(intent);
  }

  async chargeSavedPaymentMethod(
    args: ChargeSavedPaymentMethodArgs,
  ): Promise<ProviderPaymentIntentResult> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: args.amountCents,
        currency: args.currency,
        customer: args.providerCustomerId,
        payment_method: args.providerPaymentMethodId,
        confirm: true,
        off_session: true,
        metadata: args.metadata,
      },
      {
        idempotencyKey: args.idempotencyKey,
        ...(args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : {}),
      },
    );
    return mapPaymentIntent(intent);
  }

  async collectCardPresentPayment(
    args: CollectCardPresentPaymentArgs,
  ): Promise<ProviderPaymentIntentResult> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: args.amountCents,
        currency: args.currency,
        payment_method_types: ["card_present"],
        capture_method: "automatic",
        metadata: args.metadata,
      },
      {
        idempotencyKey: args.idempotencyKey,
        ...(args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : {}),
      },
    );
    if (["succeeded", "canceled"].includes(intent.status)) {
      return mapPaymentIntent(intent);
    }
    const reader = await this.client.terminal.readers.processPaymentIntent(
      args.readerId,
      { payment_intent: intent.id },
      args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : undefined,
    );
    const processed = reader.action?.process_payment_intent?.payment_intent;
    if (processed && typeof processed !== "string") return mapPaymentIntent(processed);
    return this.retrievePaymentIntent({
      connectedAccountId: args.connectedAccountId,
      paymentIntentId: intent.id,
    });
  }

  async retrievePaymentIntent(args: RetrievePaymentIntentArgs): Promise<ProviderPaymentIntentResult> {
    const intent = await this.client.paymentIntents.retrieve(
      args.paymentIntentId,
      { expand: ["payment_method"] },
      args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : undefined,
    );
    return mapPaymentIntent(intent);
  }

  async refund(args: RefundArgs): Promise<RefundResult> {
    try {
      const refund = await this.client.refunds.create(
        {
          payment_intent: args.providerPaymentId,
          amount: args.amountCents,
          metadata: args.metadata,
        },
        {
          idempotencyKey: args.idempotencyKey,
          ...(args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : {}),
        },
      );
      return { id: refund.id, status: mapRefundStatus(refund.status) };
    } catch (error) {
      // Round 2 follow-up: "charge_already_refunded" is a
      // StripeInvalidRequestError, but it does NOT mean this refund
      // failed -- it means the DESIRED END STATE (the charge is
      // refunded) may already be true, just not through THIS exact
      // request. This is a real, reachable case: Stripe's idempotency-key
      // cache expires after 24 hours, so a refund attempt that was
      // genuinely delayed that long (e.g. a stuck refund recovered by
      // reconciliation well after the fact) is no longer treated as a
      // replay -- Stripe processes it as a new request and correctly
      // rejects it because the charge is, in fact, already refunded
      // (through the ORIGINAL attempt, whose result was simply never
      // persisted locally). Treating that as a definitive FAILURE would
      // be wrong twice over: it contradicts what actually happened, and
      // FAILED rows are never revisited by reconciliation. Look up the
      // real, existing refund and return ITS actual state instead of
      // guessing or throwing.
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "charge_already_refunded") {
        const reconciled = await this.findExistingRefundForPaymentIntent(
          args.providerPaymentId,
          args.connectedAccountId,
        );
        if (reconciled) return reconciled;
        // Stripe POSITIVELY told us the charge is already refunded --
        // that is itself confirmation money moved. Failing to locate the
        // matching refund object here is OUR lookup being unreliable
        // (eventual consistency, pagination, a lookup bug), never proof
        // the refund didn't happen. The one thing this must never become
        // is a ProviderDefinitiveError (which `toProviderError` below
        // WOULD produce for any StripeInvalidRequestError, including this
        // one) -- that would directly contradict what Stripe just told
        // us. Throw a plain (ambiguous) error instead, deliberately NOT
        // routed through toProviderError, so the caller leaves this
        // PENDING and retries later -- by then the lookup may succeed, or
        // a human investigates why it can't.
        throw new Error(
          `Stripe reported charge_already_refunded for PaymentIntent ${args.providerPaymentId}, but no ` +
            "matching refund object could be found via refunds.list. This needs investigation, not automatic failure.",
          { cause: error },
        );
      }
      throw toProviderError(error);
    }
  }

  /**
   * Looks up the real refund Stripe already recorded against this
   * PaymentIntent -- used only to reconcile the "charge_already_refunded"
   * case above. MVP refund policy is full-refunds-only, so at most one
   * real refund is ever expected per PaymentIntent; Stripe returns
   * refunds most-recent-first, so `data[0]` is the one that matters if
   * this assumption is ever violated by a manual out-of-band refund.
   */
  private async findExistingRefundForPaymentIntent(
    providerPaymentId: string,
    connectedAccountId: string | undefined,
  ): Promise<RefundResult | undefined> {
    const refunds = await this.client.refunds.list(
      { payment_intent: providerPaymentId, limit: 1 },
      connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
    );
    const existing = refunds.data[0];
    return existing ? { id: existing.id, status: mapRefundStatus(existing.status) } : undefined;
  }

  async retrieveRefund(args: RetrieveRefundArgs): Promise<RefundResult> {
    try {
      const refund = await this.client.refunds.retrieve(
        args.providerRefundId,
        undefined,
        args.connectedAccountId ? { stripeAccount: args.connectedAccountId } : undefined,
      );
      return { id: refund.id, status: mapRefundStatus(refund.status) };
    } catch (error) {
      throw toProviderError(error);
    }
  }

  verifyWebhookSignature(args: VerifyWebhookArgs): VerifiedProviderEvent {
    const event = this.client.webhooks.constructEvent(args.rawBody, args.signatureHeader, this.webhookSecret);
    if (event.type === "refund.updated" || event.type === "charge.refund.updated") {
      const refundObject = event.data.object as Stripe.Refund;
      return {
        id: event.id,
        type: "refund.updated",
        refund: {
          providerRefundId: refundObject.id,
          status: mapRefundStatus(refundObject.status),
          metadata: (refundObject.metadata as Record<string, string> | null) ?? {},
        },
      };
    }
    const intentObject = event.data.object as Stripe.PaymentIntent;
    return {
      id: event.id,
      type: event.type,
      paymentIntentId: intentObject.id,
      metadata: intentObject.metadata ?? {},
    };
  }
}

function mapPaymentIntent(intent: Stripe.PaymentIntent): ProviderPaymentIntentResult {
  const card =
    intent.payment_method && typeof intent.payment_method !== "string" && intent.payment_method.type === "card"
      ? intent.payment_method.card
      : null;
  return {
    id: intent.id,
    status: mapIntentStatus(intent),
    clientSecret: intent.client_secret ?? undefined,
    amountCents: intent.amount,
    currency: intent.currency,
    metadata: intent.metadata ?? {},
    failureCode: intent.last_payment_error?.code ?? undefined,
    failureMessage: intent.last_payment_error?.message ?? undefined,
    paymentMethod:
      card && intent.payment_method && typeof intent.payment_method !== "string"
        ? {
            id: intent.payment_method.id,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
          }
        : undefined,
  };
}

function mapIntentStatus(intent: Stripe.PaymentIntent): ProviderPaymentStatus {
  switch (intent.status) {
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "CANCELED";
    case "processing":
    case "requires_capture":
      return "PROCESSING";
    case "requires_action":
    case "requires_confirmation":
      return "REQUIRES_ACTION";
    case "requires_payment_method":
      // A declined attempt reverts a real PaymentIntent to
      // requires_payment_method rather than a distinct "failed" status --
      // last_payment_error is what actually distinguishes "never
      // attempted yet" from "just declined."
      return intent.last_payment_error ? "FAILED" : "REQUIRES_PAYMENT_METHOD";
    default:
      return "REQUIRES_PAYMENT_METHOD";
  }
}

// Round 2 follow-up: Stripe's refund status is mapped to our own
// three-value ProviderRefundStatus here, inside the provider, matching
// this codebase's existing convention of the provider normalizing raw
// processor statuses (see mapIntentStatus above) rather than leaking them
// to @cinema/ticketing.
function mapRefundStatus(status: Stripe.Refund["status"] | null | undefined): ProviderRefundStatus {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed" || status === "canceled") return "FAILED";
  return "PENDING"; // "pending", "requires_action", or anything unrecognized.
}

// Round 2 follow-up: a Stripe refund/retrieve call can fail for two
// fundamentally different reasons that must not be conflated -- see
// ProviderDefinitiveError's doc comment in ./payment-provider.ts. Only
// `StripeInvalidRequestError` represents Stripe positively telling us the
// request itself is invalid/rejected -- retrying that exact request will
// never succeed. Every other Stripe SDK error class (StripeConnectionError,
// StripeAPIError, StripeRateLimitError, StripeAuthenticationError, or
// anything else) means we don't actually know whether Stripe processed the
// request before we lost the response, so those pass through unchanged as
// plain errors -- TicketingService treats anything that isn't a
// ProviderDefinitiveError as "outcome unknown, safe and necessary to retry."
function toProviderError(error: unknown): Error {
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return new ProviderDefinitiveError(error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
