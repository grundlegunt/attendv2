/**
 * Unit tests for StripePaymentProvider's own error-classification and
 * reconciliation logic (the ProviderDefinitiveError vs. "ambiguous,
 * retryable" split, and the charge_already_refunded reconciliation path).
 *
 * These exercise the real code in ./stripe-payment-provider.ts directly,
 * against a mocked Stripe SDK client (constructor-injected -- see
 * StripePaymentProvider's own doc comment) built from REAL
 * `Stripe.errors.*` classes, not generic Errors -- so `error instanceof
 * Stripe.errors.StripeInvalidRequestError` is actually true here, the
 * same way it would be against the real SDK. No real network access or
 * Stripe test-mode keys required.
 */
import Stripe from "stripe";
import { StripePaymentProvider } from "./stripe-payment-provider";
import { ProviderDefinitiveError } from "./payment-provider";

/**
 * Builds an object that `instanceof SomeStripeErrorClass` and
 * `instanceof Error` both recognize as true, without depending on the
 * exact constructor signature of stripe-node's internal error classes --
 * `Object.create` preserves the full prototype chain up to
 * `Error.prototype` regardless.
 */
function makeStripeError(
  ErrorClass: { prototype: Error; name: string },
  props: { message: string; code?: string; type?: string },
): Error {
  const error = Object.create(ErrorClass.prototype) as Error & { code?: string; type?: string };
  error.message = props.message;
  error.name = ErrorClass.name;
  if (props.code) error.code = props.code;
  if (props.type) error.type = props.type;
  return error;
}

interface FakeStripeClientOverrides {
  refundsCreate?: jest.Mock;
  refundsList?: jest.Mock;
  refundsRetrieve?: jest.Mock;
}

function createFakeStripeClient(overrides: FakeStripeClientOverrides = {}): Stripe {
  return {
    refunds: {
      create: overrides.refundsCreate ?? jest.fn(),
      list: overrides.refundsList ?? jest.fn(),
      retrieve: overrides.refundsRetrieve ?? jest.fn(),
    },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Stripe;
}

function makeProvider(client: Stripe): StripePaymentProvider {
  return new StripePaymentProvider("sk_test_fake", "whsec_fake", client);
}

describe("StripePaymentProvider refund error classification", () => {
  it("refund() reconciles against Stripe's existing refund when Stripe reports charge_already_refunded, instead of treating it as a failure", async () => {
    const alreadyRefundedError = makeStripeError(Stripe.errors.StripeInvalidRequestError, {
      message: "The charge ch_fake has already been refunded.",
      code: "charge_already_refunded",
      type: "invalid_request_error",
    });
    const refundsCreate = jest.fn().mockRejectedValue(alreadyRefundedError);
    const refundsList = jest.fn().mockResolvedValue({ data: [{ id: "re_real_existing", status: "succeeded" }] });
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList }));

    const result = await provider.refund({
      connectedAccountId: "acct_fake",
      providerPaymentId: "pi_fake",
      amountCents: 1500,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-1",
    });

    expect(result).toEqual({ id: "re_real_existing", status: "SUCCEEDED" });
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsList).toHaveBeenCalledWith({ payment_intent: "pi_fake", limit: 1 }, { stripeAccount: "acct_fake" });
  });

  it("refund() reconciles correctly for the platform account (no connectedAccountId) too -- refunds.list called without a stripeAccount option", async () => {
    const alreadyRefundedError = makeStripeError(Stripe.errors.StripeInvalidRequestError, {
      message: "The charge ch_fake has already been refunded.",
      code: "charge_already_refunded",
    });
    const refundsCreate = jest.fn().mockRejectedValue(alreadyRefundedError);
    const refundsList = jest.fn().mockResolvedValue({ data: [{ id: "re_real_existing_2", status: "pending" }] });
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList }));

    const result = await provider.refund({
      providerPaymentId: "pi_fake_2",
      amountCents: 500,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-2",
    });

    expect(result).toEqual({ id: "re_real_existing_2", status: "PENDING" });
    expect(refundsList).toHaveBeenCalledWith({ payment_intent: "pi_fake_2", limit: 1 }, undefined);
  });

  it("refund() throws ProviderDefinitiveError for a genuine Stripe-confirmed rejection that is NOT charge_already_refunded", async () => {
    const rejectionError = makeStripeError(Stripe.errors.StripeInvalidRequestError, {
      message: "Refund amount ($9999.99) is greater than charge amount ($15.00)",
      code: "amount_too_large",
      type: "invalid_request_error",
    });
    const refundsCreate = jest.fn().mockRejectedValue(rejectionError);
    const refundsList = jest.fn();
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList }));

    const promise = provider.refund({
      providerPaymentId: "pi_fake_3",
      amountCents: 999_999,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-3",
    });

    await expect(promise).rejects.toBeInstanceOf(ProviderDefinitiveError);
    expect(refundsList).not.toHaveBeenCalled();
  });

  it("refund() does NOT throw ProviderDefinitiveError for a network/connection-level Stripe error -- the true outcome is unknown, never treated as confirmed failed", async () => {
    const connectionError = makeStripeError(Stripe.errors.StripeConnectionError, {
      message: "Simulated network failure reaching Stripe.",
    });
    const refundsCreate = jest.fn().mockRejectedValue(connectionError);
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList: jest.fn() }));

    const promise = provider.refund({
      providerPaymentId: "pi_fake_4",
      amountCents: 1500,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-4",
    });

    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(ProviderDefinitiveError);
  });

  it("refund() does NOT throw ProviderDefinitiveError for a Stripe-side 5xx API error either", async () => {
    const apiError = makeStripeError(Stripe.errors.StripeAPIError, { message: "Simulated Stripe server error." });
    const refundsCreate = jest.fn().mockRejectedValue(apiError);
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList: jest.fn() }));

    const promise = provider.refund({
      providerPaymentId: "pi_fake_5",
      amountCents: 1500,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-5",
    });

    await expect(promise).rejects.not.toBeInstanceOf(ProviderDefinitiveError);
  });

  it("retrieveRefund() classifies a genuine invalid-request rejection (e.g. an id that no longer resolves) as ProviderDefinitiveError too", async () => {
    const notFoundError = makeStripeError(Stripe.errors.StripeInvalidRequestError, {
      message: "No such refund: 're_bogus'",
      code: "resource_missing",
      type: "invalid_request_error",
    });
    const provider = makeProvider(createFakeStripeClient({ refundsRetrieve: jest.fn().mockRejectedValue(notFoundError) }));

    await expect(provider.retrieveRefund({ providerRefundId: "re_bogus" })).rejects.toBeInstanceOf(
      ProviderDefinitiveError,
    );
  });

  it("refund() does NOT throw ProviderDefinitiveError if charge_already_refunded is reported but no matching refund can actually be found -- Stripe's own claim that the charge was refunded must never be contradicted by a failed local lookup", async () => {
    const alreadyRefundedError = makeStripeError(Stripe.errors.StripeInvalidRequestError, {
      message: "The charge ch_fake has already been refunded.",
      code: "charge_already_refunded",
    });
    const refundsCreate = jest.fn().mockRejectedValue(alreadyRefundedError);
    const refundsList = jest.fn().mockResolvedValue({ data: [] });
    const provider = makeProvider(createFakeStripeClient({ refundsCreate, refundsList }));

    const promise = provider.refund({
      providerPaymentId: "pi_fake_6",
      amountCents: 1500,
      reason: "SEAT_UNAVAILABLE_AFTER_PAYMENT",
      idempotencyKey: "refund:payment-6",
    });

    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(ProviderDefinitiveError);
    await expect(promise).rejects.toMatchObject({ message: expect.stringContaining("charge_already_refunded") });
    expect(refundsList).toHaveBeenCalledTimes(1);
  });
});
