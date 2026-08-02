"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  TicketCheckoutResponse,
  TicketConfirmationResponse,
} from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { QRCodeSVG } from "qrcode.react";

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

interface StripeExpressCheckoutElement extends StripeElement {
  on(event: "confirm", handler: () => void): void;
}

interface StripeElements {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
  create(type: "expressCheckout", options?: Record<string, unknown>): StripeExpressCheckoutElement;
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
  onBack,
}: {
  showtimeId: string;
  holdTokens: string[];
  holderKey: string;
  seats: string[];
  movie: string;
  auditorium: string;
  onBack: () => void;
}) {
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [checkout, setCheckout] = useState<TicketCheckoutResponse | null>(null);
  const [confirmation, setConfirmation] =
    useState<TicketConfirmationResponse | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [diningAuthorization, setDiningAuthorization] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const stripeRef = useRef<StripeClient | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripeElement | null>(null);
  const expressCheckoutElementRef = useRef<StripeExpressCheckoutElement | null>(null);

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

  useEffect(() => () => {
    expressCheckoutElementRef.current?.destroy();
    paymentElementRef.current?.destroy();
  }, []);

  async function confirmAndFinalize(
    stripe: StripeClient,
    elements: StripeElements,
    orderId: string,
  ) {
    setPending(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { receipt_email: email },
      });
      if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
      setConfirmation(
        await apiFetch<TicketConfirmationResponse>(
          `/ticketing/orders/${orderId}/finalize`,
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

  async function beginCheckout(event: FormEvent) {
    event.preventDefault();
    if (!config || diningAuthorization === null) return;
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
            diningAuthorizationRequested: diningAuthorization,
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
      const expressCheckoutElement = elements.create("expressCheckout", {
        paymentMethods: { applePay: "always" },
        buttonType: { applePay: "check-out" },
      });
      expressCheckoutElement.on("confirm", () => {
        void confirmAndFinalize(stripe, elements, created.orderId);
      });
      stripeRef.current = stripe;
      elementsRef.current = elements;
      paymentElementRef.current = paymentElement;
      expressCheckoutElementRef.current = expressCheckoutElement;
      window.setTimeout(() => {
        expressCheckoutElement.mount("#attend-express-checkout-element");
        paymentElement.mount("#attend-payment-element");
      }, 0);
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
    await confirmAndFinalize(stripeRef.current, elementsRef.current, checkout.orderId);
  }

  if (confirmation) {
    return (
      <section className="ticket-confirmation">
        <span className="eyebrow">ORDER CONFIRMED</span>
        <h2>See you at the movies.</h2>
        <p>
          Confirmation <strong>{confirmation.orderNumber}</strong> is ready.
          {confirmation.receiptDelivery === "SENT"
            ? ` A receipt with your QR tickets was sent to ${email}.`
            : " Save these tickets for admission."}
        </p>
        {confirmation.diningAuthorization === "AUTHORIZED" && (
          <p>Your saved card is authorized for food and drinks during this visit.</p>
        )}
        {confirmation.tickets.map((ticket) => (
          <div className="confirmation-card digital-ticket" key={ticket.id}>
            <div>
              <h3>{ticket.movie}</h3>
              <p>{new Date(ticket.startsAt).toLocaleString([], {
                weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
              })}</p>
              <p>{ticket.auditorium} · Seat {ticket.seat}</p>
            </div>
            <div className="ticket-qr" aria-label={`Admission QR code for seat ${ticket.seat}`}>
              <QRCodeSVG value={ticket.issuanceToken} size={180} level="M" marginSize={2} />
            </div>
          </div>
        ))}
        <strong>{money(confirmation.totalCents, confirmation.currency)}</strong>
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
              Would you like to save this card for food and drinks during this
              visit? If you authorize it, your final dining total can be charged
              after service. You can still choose another payment method later.
            </p>
            <label>
              <input
                type="radio"
                name="dining-authorization"
                checked={diningAuthorization === true}
                onChange={() => setDiningAuthorization(true)}
              />
              Yes, save and authorize this card
            </label>
            <label>
              <input
                type="radio"
                name="dining-authorization"
                checked={diningAuthorization === false}
                onChange={() => setDiningAuthorization(false)}
              />
              No, I’ll pay separately
            </label>
          </div>
          {config && !config.payment.ready && (
            <div className="configuration-note">
              Test checkout is built, but this preview still needs its Stripe test
              keys connected before a payment can be submitted.
            </div>
          )}
          <button
            className="primary"
            disabled={
              pending ||
              diningAuthorization === null ||
              !config?.ticketTypes.length ||
              !config.payment.ready
            }
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
            <h3>Payment</h3>
            <div id="attend-express-checkout-element" />
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
