"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  TicketCheckoutResponse,
  TicketConfirmationResponse,
} from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface CheckoutConfig {
  currency: string;
  ticketTypes: Array<{ id: string; name: string }>;
  payment: {
    ready: boolean;
    publishableKey: string | null;
    connectedAccountId: string | null;
  };
}

interface StripeElement {
  mount(selector: string): void;
  destroy(): void;
}

interface StripeElements {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
}

interface StripeClient {
  elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements;
  confirmPayment(options: {
    elements: StripeElements;
    redirect: "if_required";
    confirmParams: { receipt_email: string };
  }): Promise<{ error?: { message?: string } }>;
}

declare global {
  interface Window {
    Stripe?: (
      publishableKey: string,
      options?: { stripeAccount?: string },
    ) => StripeClient;
  }
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

async function loadStripe() {
  if (window.Stripe) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.stripe.com/v3/"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Stripe could not load.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Stripe could not load."));
    document.head.appendChild(script);
  });
}

export function TicketCheckout({
  showtimeId,
  holdTokens,
  holderKey,
  seats,
  movie,
  auditorium,
  startsAt,
  onBack,
}: {
  showtimeId: string;
  holdTokens: string[];
  holderKey: string;
  seats: string[];
  movie: string;
  auditorium: string;
  startsAt: string;
  onBack: () => void;
}) {
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [checkout, setCheckout] = useState<TicketCheckoutResponse | null>(null);
  const [confirmation, setConfirmation] =
    useState<TicketConfirmationResponse | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const stripeRef = useRef<StripeClient | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripeElement | null>(null);

  useEffect(() => {
    apiFetch<CheckoutConfig>(
      `/ticketing/showtimes/${showtimeId}/checkout-config`,
    )
      .then(setConfig)
      .catch((requestError) =>
        setError(
          requestError instanceof ApiRequestError
            ? requestError.body.message
            : "Checkout is temporarily unavailable.",
        ),
      );
  }, [showtimeId]);

  useEffect(
    () => () => paymentElementRef.current?.destroy(),
    [],
  );

  async function beginCheckout(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setPending(true);
    setError(null);
    try {
      const storageKey = `attend-checkout:${showtimeId}:${holdTokens.join(":")}`;
      let idempotencyKey = window.sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem(storageKey, idempotencyKey);
      }
      const created = await apiFetch<TicketCheckoutResponse>(
        "/ticketing/checkouts",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            holdTokens,
            holderKey,
            ticketTypeId: config.ticketTypes[0]?.id,
            email,
            name: name || undefined,
            // Card-on-file dining authorization is Milestone 5 scope --
            // see the informational note in the form below. Nothing in
            // this checkout flow can act on `true` yet, so it is never
            // sent as anything other than false.
            diningAuthorizationRequested: false,
          }),
        },
      );
      setCheckout(created);
      if (!created.payment?.clientSecret) {
        throw new Error("A secure payment session could not be created.");
      }
      await loadStripe();
      if (!window.Stripe || !config.payment.publishableKey) {
        throw new Error("Stripe test payments are not configured.");
      }
      const stripe = window.Stripe(config.payment.publishableKey, {
        stripeAccount: config.payment.connectedAccountId ?? undefined,
      });
      const elements = stripe.elements({
        clientSecret: created.payment.clientSecret,
        appearance: {
          theme: "night",
          variables: { colorPrimary: "#f2573f", borderRadius: "0px" },
        },
      });
      const paymentElement = elements.create("payment", {
        layout: "tabs",
      });
      stripeRef.current = stripe;
      elementsRef.current = elements;
      paymentElementRef.current = paymentElement;
      window.setTimeout(() => paymentElement.mount("#attend-payment-element"), 0);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : requestError instanceof Error
            ? requestError.message
            : "Checkout could not be started.",
      );
    } finally {
      setPending(false);
    }
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (!checkout || !stripeRef.current || !elementsRef.current) return;
    setPending(true);
    setError(null);
    try {
      const result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: "if_required",
        confirmParams: { receipt_email: email },
      });
      if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
      setConfirmation(
        await apiFetch<TicketConfirmationResponse>(
          `/ticketing/orders/${checkout.orderId}/finalize`,
          { method: "POST", body: "{}" },
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : requestError instanceof Error
            ? requestError.message
            : "Payment could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  if (confirmation) {
    return (
      <section className="ticket-confirmation">
        <span className="eyebrow">ORDER CONFIRMED</span>
        <h2>See you at the movies.</h2>
        <p>
          Confirmation <strong>{confirmation.orderNumber}</strong> was sent to{" "}
          <strong>{email}</strong>.
        </p>
        <div className="confirmation-card">
          <h3>{confirmation.tickets[0]?.movie ?? movie}</h3>
          <p>
            {new Date(startsAt).toLocaleString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <p>
            {auditorium} · Seats{" "}
            {confirmation.tickets.map((ticket) => ticket.seat).join(", ")}
          </p>
          <strong>{money(confirmation.totalCents, confirmation.currency)}</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="ticket-checkout">
      <button className="link" type="button" onClick={onBack}>
        ← Change seats
      </button>
      <div className="checkout-heading">
        <span className="eyebrow">TICKETS + PAYMENT</span>
        <h2>{movie}</h2>
        <p>
          {auditorium} · Seats {seats.join(", ")}
        </p>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!checkout ? (
        <form className="checkout-form" onSubmit={beginCheckout}>
          <div className="checkout-panel">
            <h3>Receipt</h3>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>
          <div className="checkout-panel authorization-note">
            <h3>Food + drink during the movie</h3>
            <p>
              Card-on-file ordering for food and drinks isn't available yet. Your
              server will collect payment for anything you order tonight
              separately, in person. This card is only charged for your ticket
              order above.
            </p>
          </div>
          {config && !config.payment.ready && (
            <div className="configuration-note">
              Test checkout is built, but this preview still needs its Stripe test
              keys connected before a payment can be submitted.
            </div>
          )}
          <button
            className="primary"
            disabled={pending || !config?.ticketTypes.length || !config.payment.ready}
          >
            {pending ? "Preparing secure checkout…" : "Continue to payment"}
          </button>
        </form>
      ) : (
        <form className="payment-form" onSubmit={pay}>
          <div className="checkout-panel order-total">
            <h3>Order</h3>
            <p><span>Tickets ({seats.length})</span><strong>{money(checkout.subtotalCents, checkout.currency)}</strong></p>
            <p><span>Service fee</span><strong>{money(checkout.feesCents, checkout.currency)}</strong></p>
            <p><span>Tax</span><strong>{money(checkout.taxCents, checkout.currency)}</strong></p>
            <p className="total"><span>Total</span><strong>{money(checkout.totalCents, checkout.currency)}</strong></p>
          </div>
          <div className="checkout-panel">
            <h3>Card or Apple Pay</h3>
            <div id="attend-payment-element" />
          </div>
          <button className="primary" disabled={pending}>
            {pending
              ? "Completing purchase…"
              : `Pay ${money(checkout.totalCents, checkout.currency)}`}
          </button>
        </form>
      )}
    </section>
  );
}
