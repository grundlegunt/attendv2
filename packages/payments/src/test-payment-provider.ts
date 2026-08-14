import { createHash, randomUUID } from "node:crypto";
import {
  ProviderDefinitiveError,
  type CreatePaymentIntentArgs,
  type CreateProviderCustomerArgs,
  type ChargeSavedPaymentMethodArgs,
  type CollectCardPresentPaymentArgs,
  type PaymentProvider,
  type ProviderPaymentIntentResult,
  type ProviderPaymentStatus,
  type RefundArgs,
  type RefundResult,
  type RetrievePaymentIntentArgs,
  type RetrieveRefundArgs,
  type VerifiedProviderEvent,
  type VerifyWebhookArgs,
} from "./payment-provider";

/**
 * Deterministic PaymentProvider test double, used whenever
 * env.PAYMENT_PROVIDER === "test" (only permitted when NODE_ENV=test — see
 * packages/config/src/env.ts). This is the intended test seam: ticketing
 * domain logic only ever talks to the PaymentProvider interface, so
 * testing it against this controllable fake is testing the real
 * seat/payment DB-transaction logic, not mocking away the thing under
 * test. What this fake does NOT cover: Stripe's own API behavior or real
 * webhook signature verification — those require real test-mode Stripe
 * keys and are exercised instead by stripe-payment-provider.spec.ts's
 * mocked-Stripe-client unit tests.
 */
export class TestPaymentProvider implements PaymentProvider {
  readonly name = "test";

  private intents = new Map<
    string,
    {
      status: ProviderPaymentStatus;
      amountCents: number;
      currency: string;
      metadata: Record<string, string>;
      savePaymentMethodForFuture: boolean;
    }
  >();
  private customersByIdempotencyKey = new Map<string, string>();
  // Real Stripe returns the SAME PaymentIntent for repeated
  // createPaymentIntent calls sharing an idempotencyKey -- and, like real
  // Stripe, replaying an idempotency key with DIFFERENT request parameters
  // is an error, not silently ignored, so a bug that reused an
  // idempotency key with a different amount/currency attached would fail
  // loudly here the same way it would against real Stripe.
  private intentsByIdempotencyKey = new Map<string, { id: string; requestFingerprint: string }>();
  private refundsByIdempotencyKey = new Map<string, { id: string; requestFingerprint: string }>();
  // Live refund state by id -- separate from the idempotency-key cache
  // because real Stripe's idempotency replay returns the response cached
  // from the original call, not the refund's current live status. Tests
  // simulate an async pending -> succeeded/failed transition via
  // setRefundLiveStatus, and retrieveRefund reads this map.
  private refundsById = new Map<string, RefundResult>();
  // providerPaymentId -> providerRefundId, for markAlreadyRefundedByOtherPath.
  private alreadyRefundedByOtherPath = new Map<string, string>();

  refundCalls: RefundArgs[] = [];
  createPaymentIntentCalls: CreatePaymentIntentArgs[] = [];
  chargeSavedPaymentMethodCalls: ChargeSavedPaymentMethodArgs[] = [];
  collectCardPresentPaymentCalls: CollectCardPresentPaymentArgs[] = [];
  private refundFailureMode: "none" | "definitive" | "ambiguous" = "none";
  private refundFailureMessage: string | undefined;
  private nextRefundStatus: "SUCCEEDED" | "PENDING" | "FAILED" = "SUCCEEDED";

  async createCustomer(args: CreateProviderCustomerArgs) {
    const existing = this.customersByIdempotencyKey.get(args.idempotencyKey);
    if (existing) return { id: existing };
    const id = `cus_fake_${randomUUID()}`;
    this.customersByIdempotencyKey.set(args.idempotencyKey, id);
    return { id };
  }

  async createPaymentIntent(args: CreatePaymentIntentArgs): Promise<ProviderPaymentIntentResult> {
    this.createPaymentIntentCalls.push(args);
    const fingerprint = JSON.stringify({
      amountCents: args.amountCents,
      currency: args.currency,
      providerCustomerId: args.providerCustomerId,
      savePaymentMethodForFuture: Boolean(args.savePaymentMethodForFuture),
    });
    const cached = this.intentsByIdempotencyKey.get(args.idempotencyKey);
    if (cached) {
      if (cached.requestFingerprint !== fingerprint) {
        throw new Error(
          `Fake Stripe idempotency violation: createPaymentIntent idempotencyKey "${args.idempotencyKey}" was reused with different parameters.`,
        );
      }
      const intent = this.intents.get(cached.id);
      if (intent) return { id: cached.id, clientSecret: `${cached.id}_secret_fake`, ...intent };
    }
    const id = `pi_fake_${randomUUID()}`;
    this.intents.set(id, {
      status: "REQUIRES_PAYMENT_METHOD",
      amountCents: args.amountCents,
      currency: args.currency,
      metadata: args.metadata,
      savePaymentMethodForFuture: Boolean(args.savePaymentMethodForFuture),
    });
    this.intentsByIdempotencyKey.set(args.idempotencyKey, { id, requestFingerprint: fingerprint });
    return {
      id,
      clientSecret: `${id}_secret_fake`,
      status: "REQUIRES_PAYMENT_METHOD",
      amountCents: args.amountCents,
      currency: args.currency,
      metadata: args.metadata,
    };
  }

  async chargeSavedPaymentMethod(
    args: ChargeSavedPaymentMethodArgs,
  ): Promise<ProviderPaymentIntentResult> {
    this.chargeSavedPaymentMethodCalls.push(args);
    if (args.providerPaymentMethodId.includes("delayed")) {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    const status: ProviderPaymentStatus = args.providerPaymentMethodId.includes("declined")
      ? "FAILED"
      : "SUCCEEDED";
    return {
      id: `pi_fake_saved_${createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 20)}`,
      status,
      amountCents: args.amountCents,
      currency: args.currency,
      metadata: args.metadata,
      ...(status === "FAILED"
        ? { failureCode: "card_declined", failureMessage: "The saved card was declined." }
        : {}),
    };
  }

  async collectCardPresentPayment(
    args: CollectCardPresentPaymentArgs,
  ): Promise<ProviderPaymentIntentResult> {
    this.collectCardPresentPaymentCalls.push(args);
    if (args.readerId.includes("delayed")) {
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    const status: ProviderPaymentStatus = args.readerId.includes("declined")
      ? "FAILED"
      : "SUCCEEDED";
    return {
      id: `pi_fake_terminal_${createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 20)}`,
      status,
      amountCents: args.amountCents,
      currency: args.currency,
      metadata: args.metadata,
      ...(status === "FAILED"
        ? { failureCode: "card_declined", failureMessage: "The presented card was declined." }
        : {}),
    };
  }

  async retrievePaymentIntent(args: RetrievePaymentIntentArgs): Promise<ProviderPaymentIntentResult> {
    const intent = this.intents.get(args.paymentIntentId);
    if (!intent) throw new Error(`Unknown fake PaymentIntent: ${args.paymentIntentId}`);
    return {
      id: args.paymentIntentId,
      clientSecret: `${args.paymentIntentId}_secret_fake`,
      ...intent,
      paymentMethod:
        intent.status === "SUCCEEDED" && intent.savePaymentMethodForFuture
          ? {
              id: `pm_fake_${args.paymentIntentId}`,
              brand: "visa",
              last4: "4242",
              expMonth: 12,
              expYear: 2035,
            }
          : undefined,
    };
  }

  async refund(args: RefundArgs): Promise<RefundResult> {
    this.refundCalls.push(args);
    const fingerprint = JSON.stringify({ providerPaymentId: args.providerPaymentId, amountCents: args.amountCents });
    const cached = this.refundsByIdempotencyKey.get(args.idempotencyKey);
    if (cached) {
      if (cached.requestFingerprint !== fingerprint) {
        throw new Error(
          `Fake Stripe idempotency violation: refund idempotencyKey "${args.idempotencyKey}" was reused with different parameters.`,
        );
      }
      // Matches real Stripe: replaying an idempotency key returns the
      // response cached from the ORIGINAL call, not the refund's current
      // live status (see retrieveRefund below).
      const original = this.refundsById.get(cached.id);
      if (original) return original;
    }
    // Mirrors StripePaymentProvider's "charge_already_refunded"
    // reconciliation -- simulates the underlying charge having already
    // been refunded through some OTHER path before this call.
    const alreadyRefunded = this.alreadyRefundedByOtherPath.get(args.providerPaymentId);
    if (alreadyRefunded) {
      const existing = this.refundsById.get(alreadyRefunded);
      if (existing) return existing;
    }
    if (this.refundFailureMode === "definitive") {
      throw new ProviderDefinitiveError(
        this.refundFailureMessage ?? "Fake refund failure (test-configured, definitive processor rejection).",
      );
    }
    if (this.refundFailureMode === "ambiguous") {
      throw new Error(
        this.refundFailureMessage ?? "Fake refund failure (test-configured, ambiguous/network -- outcome unknown).",
      );
    }
    const id = `re_fake_${randomUUID()}`;
    const result: RefundResult = { id, status: this.nextRefundStatus };
    this.refundsByIdempotencyKey.set(args.idempotencyKey, { id, requestFingerprint: fingerprint });
    this.refundsById.set(id, result);
    return result;
  }

  async retrieveRefund(args: RetrieveRefundArgs): Promise<RefundResult> {
    const refund = this.refundsById.get(args.providerRefundId);
    if (!refund) throw new Error(`Unknown fake Refund: ${args.providerRefundId}`);
    return refund;
  }

  /** Test control: simulate the processor reporting a PaymentIntent's status. */
  setIntentStatus(intentId: string, status: ProviderPaymentStatus) {
    const existing = this.intents.get(intentId);
    if (!existing) throw new Error(`Unknown fake PaymentIntent: ${intentId}`);
    existing.status = status;
  }

  /** Test control: simulates a PaymentIntent whose actual charged amount doesn't match what was originally requested -- for proving finalizeOrder's amount-verification check rejects a mismatch instead of trusting `status: SUCCEEDED` alone. */
  setIntentAmount(intentId: string, amountCents: number) {
    const existing = this.intents.get(intentId);
    if (!existing) throw new Error(`Unknown fake PaymentIntent: ${intentId}`);
    existing.amountCents = amountCents;
  }

  /** Test control: simulates a PaymentIntent whose metadata no longer identifies the expected order. */
  setIntentMetadata(intentId: string, metadata: Record<string, string>) {
    const existing = this.intents.get(intentId);
    if (!existing) throw new Error(`Unknown fake PaymentIntent: ${intentId}`);
    existing.metadata = metadata;
  }

  /** Test control: makes the next (and subsequent, until reset) refund() calls return a specific status instead of "SUCCEEDED", without throwing -- matching a real processor's non-exceptional non-success responses. */
  makeRefundsReturnStatus(status: "SUCCEEDED" | "PENDING" | "FAILED") {
    this.nextRefundStatus = status;
  }

  /** Test control: simulates Stripe asynchronously settling a refund some time after creation (e.g. an ACH refund moving from pending to succeeded) -- mutates the LIVE object retrieveRefund reads, independent of the idempotency-keyed creation cache. */
  setRefundLiveStatus(refundId: string, status: "SUCCEEDED" | "PENDING" | "FAILED") {
    const existing = this.refundsById.get(refundId);
    if (!existing) throw new Error(`Unknown fake Refund: ${refundId}`);
    this.refundsById.set(refundId, { ...existing, status });
  }

  /** Test control: makes every subsequent refund() call throw a ProviderDefinitiveError, simulating the processor positively rejecting the request (e.g. already refunded) -- retrying can never succeed. */
  makeRefundsFail() {
    this.refundFailureMode = "definitive";
    this.refundFailureMessage = undefined;
  }

  /** Test control: makes every subsequent refund() call throw a plain Error, simulating a network error/timeout/5xx where the true outcome is unknown -- must be treated as retryable, never as a confirmed failure. */
  makeRefundsFailAmbiguously() {
    this.refundFailureMode = "ambiguous";
    this.refundFailureMessage = undefined;
  }

  /** Test control: clears any configured refund failure mode -- simulates a transient issue clearing before the next retry. */
  stopFailingRefunds() {
    this.refundFailureMode = "none";
    this.refundFailureMessage = undefined;
  }

  /**
   * Test control: a definitive, processor-confirmed refund rejection
   * carrying a specific operator-facing reason (e.g. "simulated processor
   * outage") -- equivalent to makeRefundsFail() but lets a test assert on
   * the failure message that ends up on the resulting AuditEvent. Pass
   * `null` to clear it, equivalent to stopFailingRefunds().
   */
  setRefundFailure(reason: string | null) {
    if (reason === null) {
      this.stopFailingRefunds();
      return;
    }
    this.refundFailureMode = "definitive";
    this.refundFailureMessage = reason;
  }

  /**
   * Test control: produces a deterministic fake "signature" string for a
   * raw webhook body. This fake's verifyWebhookSignature never inspects
   * the signature header at all (there is no real Stripe envelope to
   * verify against -- see its doc comment below), so any non-empty string
   * would work; hashing the body just gives tests something realistic and
   * deterministic to pass as the `Stripe-Signature` header.
   */
  signWebhook(rawBody: Buffer): string {
    return `test_sig_${createHash("sha256").update(rawBody).digest("hex")}`;
  }

  /** Test control: simulates a charge already having a real refund recorded against it via some other path (an expired idempotency key on a stuck retry, a manual out-of-band refund). */
  markAlreadyRefundedByOtherPath(providerPaymentId: string, existingRefundId: string, status: "SUCCEEDED" | "PENDING" | "FAILED") {
    this.alreadyRefundedByOtherPath.set(providerPaymentId, existingRefundId);
    this.refundsById.set(existingRefundId, { id: existingRefundId, status });
  }

  /**
   * Parses the raw body directly as an already-normalized
   * VerifiedProviderEvent -- this fake has no real Stripe envelope to
   * unwrap, so tests construct fake webhook bodies matching the
   * normalized shape @cinema/ticketing actually consumes. Malformed input
   * fails the same way a real forged/corrupt signature would fail real
   * verification, exercising the same catch path.
   */
  verifyWebhookSignature(args: VerifyWebhookArgs): VerifiedProviderEvent {
    return JSON.parse(args.rawBody.toString()) as VerifiedProviderEvent;
  }
}
