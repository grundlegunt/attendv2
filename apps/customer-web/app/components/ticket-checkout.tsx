"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  mount(target: string | HTMLElement): void;
  unmount(): void;
  destroy(): void;
  on(event: "ready", handler: () => void): void;
  on(
    event: "loaderror",
    handler: (event: { error?: { message?: string } }) => void,
  ): void;
}

interface StripeExpressCheckoutElement {
  mount(target: string | HTMLElement): void;
  unmount(): void;
  destroy(): void;
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
      existing.remove();
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Stripe could not load."));
    };
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
  const [promotionCode, setPromotionCode] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [diningAuthorization, setDiningAuthorization] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [mountableElements, setMountableElements] = useState<{
    payment: StripeElement;
    express: StripeExpressCheckoutElement;
  } | null>(null);
  const stripeRef = useRef<StripeClient | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const pendingRef = useRef(false);
  const paymentContainerRef = useRef<HTMLDivElement | null>(null);
  const expressCheckoutContainerRef = useRef<HTMLDivElement | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setError(null);
    try {
      setConfig(
        await apiFetch<CheckoutConfig>(
          `/ticketing/showtimes/${showtimeId}/checkout-config`,
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : "Checkout is temporarily unavailable.",
      );
    } finally {
      setConfigLoading(false);
    }
  }, [showtimeId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!mountableElements || confirmation) return;
    const paymentContainer = paymentContainerRef.current;
    const expressContainer = expressCheckoutContainerRef.current;
    if (!paymentContainer || !expressContainer) return;

    mountableElements.express.mount(expressContainer);
    mountableElements.payment.mount(paymentContainer);
    return () => {
      mountableElements.express.unmount();
      mountableElements.payment.unmount();
    };
  }, [confirmation, mountableElements]);

  async function confirmAndFinalize(
    stripe: StripeClient,
    elements: StripeElements,
    orderId: string,
  ) {
    if (pendingRef.current) return;
    pendingRef.current = true;
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
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function initializePayment(created: TicketCheckoutResponse) {
    if (!created.payment?.clientSecret || !config?.payment.publishableKey) {
      throw new Error("Stripe test payments are not configured.");
    }
    await loadStripe();
    if (!window.Stripe) throw new Error("Stripe could not load.");
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
    paymentElement.on("ready", () => setPaymentElementReady(true));
    paymentElement.on("loaderror", (event) => {
      setPaymentElementReady(false);
      stripeRef.current = null;
      elementsRef.current = null;
      setMountableElements(null);
      setError(
        event.error?.message ??
          "The secure payment form could not load. Please try again.",
      );
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
    setPaymentElementReady(false);
    setMountableElements({
      payment: paymentElement,
      express: expressCheckoutElement,
    });
  }

  async function retryPaymentSetup() {
    if (!checkout || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await initializePayment(checkout);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The secure payment form could not load.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function beginCheckout(event: FormEvent) {
    event.preventDefault();
    if (!config || diningAuthorization === null || pendingRef.current) return;
    pendingRef.current = true;
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
            promotionCode: promotionCode.trim() || undefined,
            giftCardCode: giftCardCode.trim() || undefined,
            diningAuthorizationRequested: diningAuthorization,
          }),
        },
      );
      setCheckout(created);
      if (!created.payment?.clientSecret) {
        setConfirmation(await apiFetch<TicketConfirmationResponse>(`/ticketing/orders/${created.orderId}/finalize`, { method: "POST", body: "{}" }));
        return;
      }
      await initializePayment(created);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : requestError instanceof Error
            ? requestError.message
            : "Checkout could not be started.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (
      !checkout ||
      !stripeRef.current ||
      !elementsRef.current ||
      !paymentElementReady
    ) return;
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
      <button
        className="link"
        type="button"
        disabled={pending || checkout !== null}
        onClick={onBack}
      >
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
      {!config && error && !checkout && (
        <button className="link" type="button" disabled={configLoading} onClick={() => void loadConfig()}>
          {configLoading ? "Retrying checkout…" : "Retry checkout setup"}
        </button>
      )}
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
            <label className="field">
              <span>Promotion code</span>
              <input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} autoComplete="off" />
            </label>
            <label className="field">
              <span>Gift card code</span>
              <input value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value.toUpperCase())} autoComplete="off" />
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
              configLoading ||
              diningAuthorization === null ||
              !config?.ticketTypes.length ||
              (!config.payment.ready && !giftCardCode.trim())
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
            {checkout.discountCents > 0 && <p><span>Promotion</span><strong>−{money(checkout.discountCents, checkout.currency)}</strong></p>}
            <p><span>Service fee</span><strong>{money(checkout.feesCents, checkout.currency)}</strong></p>
            <p><span>Tax</span><strong>{money(checkout.taxCents, checkout.currency)}</strong></p>
            {checkout.giftCardCents > 0 && <p><span>Gift card</span><strong>−{money(checkout.giftCardCents, checkout.currency)}</strong></p>}
            <p className="total"><span>Total</span><strong>{money(checkout.totalCents, checkout.currency)}</strong></p>
          </div>
          <div className="checkout-panel">
            <h3>Payment</h3>
            {!paymentElementReady && !error && (
              <p role="status">Loading secure payment form…</p>
            )}
            <div id="attend-express-checkout-element" ref={expressCheckoutContainerRef} />
            <div id="attend-payment-element" ref={paymentContainerRef} />
            {error && !paymentElementReady && (
              <button className="link" type="button" disabled={pending} onClick={() => void retryPaymentSetup()}>
                {pending ? "Retrying secure payment…" : "Retry secure payment setup"}
              </button>
            )}
          </div>
          <button className="primary" disabled={pending || !paymentElementReady}>
            {pending
              ? "Completing purchase…"
              : !paymentElementReady
                ? "Loading secure payment…"
              : `Pay ${money(checkout.payment?.amountCents ?? checkout.totalCents, checkout.currency)}`}
          </button>
        </form>
      )}
    </section>
  );
}
