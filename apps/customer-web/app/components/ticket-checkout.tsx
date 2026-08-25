"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  CustomerAccountResponse,
  CustomerSessionResponse,
  TicketCheckoutResponse,
  TicketConfirmationResponse,
} from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { loadStripeScript } from "../lib/stripe-loader";
import { QRCodeSVG } from "qrcode.react";
import { downloadTicketCalendar } from "../lib/ticket-calendar";
import { isCheckoutHoldExpired } from "../lib/checkout-hold";

interface CheckoutConfig {
  currency: string;
  baseTicketPriceCents: number;
  ticketTypes: Array<{ id: string; name: string; priceAdjustmentMinor: number }>;
  orderAhead: {
    available: boolean;
    categories: Array<{
      id: string;
      name: string;
      items: Array<{
        id: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        priceCents: number;
        chargeCategory: "FOOD" | "BEVERAGE" | "ALCOHOL";
        isVegan: boolean;
        isGlutenFree: boolean;
        modifierGroups: Array<{
          id: string;
          name: string;
          selectionType: "SINGLE" | "MULTIPLE";
          required: boolean;
          minSelections: number;
          maxSelections: number | null;
          modifiers: Array<{
            id: string;
            name: string;
            priceDeltaCents: number;
          }>;
        }>;
      }>;
    }>;
  };
  payment: {
    ready: boolean;
    publishableKey: string | null;
    connectedAccountId: string | null;
  };
  notifications: {
    smsTicketsAvailable: boolean;
  };
}

type OrderAheadSelection = {
  quantity: number;
  modifierIds: string[];
};

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

const PAYMENT_STATUS_POLL_LIMIT = 10;

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

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

export function TicketCheckout({
  showtimeId,
  holdTokens,
  holderKey,
  seats,
  generalAdmission,
  movie,
  auditorium,
  startsAt,
  timeZone,
  holdRemainingSeconds,
  onBack,
}: {
  showtimeId: string;
  holdTokens: string[];
  holderKey: string;
  seats: string[];
  generalAdmission: boolean;
  movie: string;
  auditorium: string;
  startsAt: string;
  timeZone: string;
  holdRemainingSeconds: number;
  onBack: () => void;
}) {
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [configShowtimeId, setConfigShowtimeId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<TicketCheckoutResponse | null>(null);
  const [confirmation, setConfirmation] =
    useState<TicketConfirmationResponse | null>(null);
  const [receiptRetryPending, setReceiptRetryPending] = useState(false);
  const [receiptRetryMessage, setReceiptRetryMessage] = useState<string | null>(null);
  const receiptRetryRequestIdRef = useRef<string | null>(null);
  const receiptRetryPendingRef = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [smsTicketsRequested, setSmsTicketsRequested] = useState(false);
  const [accountRecognized, setAccountRecognized] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState("");
  const [ticketTypeByHoldToken, setTicketTypeByHoldToken] = useState<Record<string, string>>({});
  const [diningAuthorization, setDiningAuthorization] = useState<boolean | null>(null);
  const [orderAheadOpen, setOrderAheadOpen] = useState(false);
  const [openOrderAheadCategoryId, setOpenOrderAheadCategoryId] = useState<string | null>(null);
  const [orderAheadSelections, setOrderAheadSelections] = useState<
    Record<string, OrderAheadSelection>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [mountableElements, setMountableElements] = useState<{
    payment: StripeElement;
    express: StripeExpressCheckoutElement;
  } | null>(null);
  const stripeRef = useRef<StripeClient | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const pendingRef = useRef(false);
  const paymentConfirmedRef = useRef(false);
  const holdRemainingSecondsRef = useRef(holdRemainingSeconds);
  const configRequestRef = useRef(0);
  const configLoadingRef = useRef(false);
  const paymentContainerRef = useRef<HTMLDivElement | null>(null);
  const expressCheckoutContainerRef = useRef<HTMLDivElement | null>(null);
  const nameDirtyRef = useRef(false);

  const checkoutStorageKey = `attend-checkout:${showtimeId}:${holdTokens.join(":")}`;
  const holdExpired = isCheckoutHoldExpired(holdRemainingSeconds);
  holdRemainingSecondsRef.current = holdRemainingSeconds;

  useEffect(() => {
    let active = true;
    async function loadCustomer() {
      let account: CustomerAccountResponse;
      try {
        account = await apiFetch<CustomerAccountResponse>("/auth/customers/me");
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.status === 401)) return;
        try {
          await apiFetch<CustomerSessionResponse>("/auth/customers/refresh", { method: "POST" });
          account = await apiFetch<CustomerAccountResponse>("/auth/customers/me");
        } catch {
          return;
        }
      }
      if (!active) return;
      if (!nameDirtyRef.current && account.customer.name) setName(account.customer.name);
      // A signed-in checkout must stay attached to the signed-in account.
      // Always replace any email typed while session restoration was pending.
      if (account.customer.email) setEmail(account.customer.email);
      setAccountRecognized(true);
    }
    void loadCustomer();
    return () => { active = false; };
  }, []);

  const selectedOrderAheadItems = config?.orderAhead.categories.flatMap((category) =>
    category.items.flatMap((item) => {
      const selection = orderAheadSelections[item.id];
      return selection?.quantity
        ? [{ item, quantity: selection.quantity, modifierIds: selection.modifierIds }]
        : [];
    }),
  ) ?? [];
  const orderAheadEstimateCents = selectedOrderAheadItems.reduce((total, selection) => {
    const modifierTotal = selection.item.modifierGroups
      .flatMap((group) => group.modifiers)
      .filter((modifier) => selection.modifierIds.includes(modifier.id))
      .reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0);
    return total + (selection.item.priceCents + modifierTotal) * selection.quantity;
  }, 0);

  function setOrderAheadQuantity(itemId: string, quantity: number) {
    setOrderAheadSelections((current) => {
      if (quantity <= 0) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }
      return {
        ...current,
        [itemId]: {
          quantity: Math.min(quantity, 20),
          modifierIds: current[itemId]?.modifierIds ?? [],
        },
      };
    });
  }

  function toggleOrderAheadModifier(
    itemId: string,
    modifierId: string,
    selectionType: "SINGLE" | "MULTIPLE",
    groupModifierIds: string[],
    maxSelections: number | null,
  ) {
    setOrderAheadSelections((current) => {
      const selection = current[itemId];
      if (!selection) return current;
      const otherGroupSelections = selection.modifierIds.filter(
        (id) => !groupModifierIds.includes(id),
      );
      const groupSelections = selection.modifierIds.filter((id) =>
        groupModifierIds.includes(id),
      );
      const nextGroupSelections = selectionType === "SINGLE"
        ? groupSelections.includes(modifierId) ? [] : [modifierId]
        : groupSelections.includes(modifierId)
          ? groupSelections.filter((id) => id !== modifierId)
          : maxSelections === null || groupSelections.length < maxSelections
            ? [...groupSelections, modifierId]
            : groupSelections;
      return {
        ...current,
        [itemId]: {
          ...selection,
          modifierIds: [...otherGroupSelections, ...nextGroupSelections],
        },
      };
    });
  }

  function orderAheadSelectionIsValid() {
    return selectedOrderAheadItems.every(({ item, modifierIds }) =>
      item.modifierGroups.every((group) => {
        const count = group.modifiers.filter((modifier) =>
          modifierIds.includes(modifier.id),
        ).length;
        const minimum = group.required ? Math.max(1, group.minSelections) : group.minSelections;
        return count >= minimum && (group.maxSelections === null || count <= group.maxSelections);
      }),
    );
  }

  const loadConfig = useCallback(async () => {
    if (configLoadingRef.current) return;
    configLoadingRef.current = true;
    const requestId = ++configRequestRef.current;
    setConfigLoading(true);
    setError(null);
    try {
      const nextConfig = await apiFetch<CheckoutConfig>(
        `/ticketing/showtimes/${showtimeId}/checkout-config`,
      );
      if (requestId !== configRequestRef.current) return;
      if (
        !Number.isFinite(nextConfig.baseTicketPriceCents) ||
        nextConfig.ticketTypes.some(
          (ticketType) => !Number.isFinite(ticketType.priceAdjustmentMinor),
        )
      ) {
        throw new Error("Ticket pricing is temporarily unavailable.");
      }
      setConfig(nextConfig);
      setConfigShowtimeId(showtimeId);
      setSelectedTicketTypeId((current) =>
        nextConfig.ticketTypes.some((ticketType) => ticketType.id === current)
          ? current
          : nextConfig.ticketTypes[0]?.id ?? "",
      );
      setTicketTypeByHoldToken((current) => Object.fromEntries(
        holdTokens.map((holdToken) => [
          holdToken,
          nextConfig.ticketTypes.some((ticketType) => ticketType.id === current[holdToken])
            ? current[holdToken]!
            : nextConfig.ticketTypes[0]?.id ?? "",
        ]),
      ));
    } catch (requestError) {
      if (requestId !== configRequestRef.current) return;
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : requestError instanceof Error
            ? requestError.message
          : "Checkout is temporarily unavailable.",
      );
    } finally {
      if (requestId === configRequestRef.current) {
        configLoadingRef.current = false;
        setConfigLoading(false);
      }
    }
  }, [holdTokens, showtimeId]);

  useEffect(() => {
    configRequestRef.current += 1;
    configLoadingRef.current = false;
    setConfig(null);
    setConfigShowtimeId(null);
    setSelectedTicketTypeId("");
    setTicketTypeByHoldToken({});
    void loadConfig();
    return () => {
      configRequestRef.current += 1;
      configLoadingRef.current = false;
    };
  }, [loadConfig]);

  useEffect(() => {
    if (!config || configShowtimeId !== showtimeId || checkout || confirmation || holdExpired) return;
    const idempotencyKey = window.sessionStorage.getItem(checkoutStorageKey);
    if (!idempotencyKey) return;
    let active = true;
    setResumeLoading(true);
    setError(null);
    apiFetch<TicketCheckoutResponse>("/ticketing/checkouts/resume", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ holderKey }),
    }).then(async (initialResume) => {
      let resumed = initialResume;
      let processingPolls = 0;
      while (active && resumed.payment?.status === "PROCESSING") {
        paymentConfirmedRef.current = true;
        setPaymentConfirmed(true);
        if (processingPolls >= PAYMENT_STATUS_POLL_LIMIT) {
          setCheckout(resumed);
          throw new Error("Payment is still processing. Please wait a moment, then refresh this page.");
        }
        processingPolls += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (!active) return;
        resumed = await apiFetch<TicketCheckoutResponse>("/ticketing/checkouts/resume", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ holderKey }),
        });
      }
      if (!active) return;
      setEmail(resumed.email ?? "");
      setName(resumed.name ?? "");
      setCheckout(resumed);
      if (resumed.payment?.status === "SUCCEEDED") {
        paymentConfirmedRef.current = true;
        setPaymentConfirmed(true);
        const completed = await apiFetch<TicketConfirmationResponse>(
          `/ticketing/orders/${resumed.orderId}/finalize`,
          { method: "POST", body: JSON.stringify({ holderKey }) },
        );
        if (!active) return;
        window.sessionStorage.removeItem(checkoutStorageKey);
        if (!accountRecognized) {
          window.sessionStorage.setItem(
            "attend-account-handoff",
            JSON.stringify({ email: resumed.email ?? "", name: resumed.name ?? "" }),
          );
        }
        setConfirmation(completed);
        return;
      }
      if (resumed.payment?.clientSecret) {
        paymentConfirmedRef.current = false;
        setPaymentConfirmed(false);
        await initializePayment(resumed);
      }
    }).catch((requestError) => {
      if (!active) return;
      if (requestError instanceof ApiRequestError && requestError.status === 404) {
        window.sessionStorage.removeItem(checkoutStorageKey);
        return;
      }
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : "Checkout could not be resumed.",
      );
    }).finally(() => {
      if (active) setResumeLoading(false);
    });
    return () => { active = false; };
  }, [checkout, checkoutStorageKey, config, configShowtimeId, confirmation, holdExpired, holderKey, showtimeId]);

  useEffect(() => {
    if (!mountableElements || confirmation || holdExpired) return;
    const paymentContainer = paymentContainerRef.current;
    const expressContainer = expressCheckoutContainerRef.current;
    if (!paymentContainer || !expressContainer) return;

    mountableElements.express.mount(expressContainer);
    mountableElements.payment.mount(paymentContainer);
    return () => {
      mountableElements.express.unmount();
      mountableElements.payment.unmount();
      mountableElements.express.destroy();
      mountableElements.payment.destroy();
    };
  }, [confirmation, holdExpired, mountableElements]);

  async function finalizeOrder(orderId: string) {
    const completed = await apiFetch<TicketConfirmationResponse>(
      `/ticketing/orders/${orderId}/finalize`,
      { method: "POST", body: JSON.stringify({ holderKey }) },
    );
    window.sessionStorage.removeItem(checkoutStorageKey);
    if (!accountRecognized) {
      window.sessionStorage.setItem(
        "attend-account-handoff",
        JSON.stringify({ email, name }),
      );
    }
    setConfirmation(completed);
  }

  async function confirmAndFinalize(
    stripe: StripeClient,
    elements: StripeElements,
    orderId: string,
  ) {
    if (pendingRef.current || isCheckoutHoldExpired(holdRemainingSecondsRef.current)) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (!paymentConfirmedRef.current) {
        const result = await stripe.confirmPayment({
          elements,
          redirect: "if_required",
          confirmParams: { receipt_email: email },
        });
        if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
        paymentConfirmedRef.current = true;
        setPaymentConfirmed(true);
      }
      await finalizeOrder(orderId);
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
    await loadStripeScript();
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
    if (
      !config ||
      configShowtimeId !== showtimeId ||
      diningAuthorization === null ||
      pendingRef.current
    ) return;
    const normalizedPhone = normalizePhoneNumber(phone);
    if (smsTicketsRequested && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
      setError("Enter a valid mobile number, including the country code for numbers outside the U.S.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      let idempotencyKey = window.sessionStorage.getItem(checkoutStorageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        window.sessionStorage.setItem(checkoutStorageKey, idempotencyKey);
      }
      const created = await apiFetch<TicketCheckoutResponse>(
        "/ticketing/checkouts",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            holdTokens,
            holderKey,
            ticketTypeId: selectedTicketTypeId,
            ticketTypeSelections: holdTokens.map((holdToken) => ({
              holdToken,
              ticketTypeId: ticketTypeByHoldToken[holdToken],
            })),
            email,
            name: name || undefined,
            phone: smsTicketsRequested ? normalizedPhone : undefined,
            smsTicketsRequested,
            promotionCode: promotionCode.trim() || undefined,
            giftCardCode: giftCardCode.trim() || undefined,
            diningAuthorizationRequested: diningAuthorization,
            orderAhead: selectedOrderAheadItems.length
              ? selectedOrderAheadItems.map(({ item, quantity, modifierIds }) => ({
                  menuItemId: item.id,
                  quantity,
                  modifierIds,
                }))
              : undefined,
          }),
        },
      );
      setCheckout(created);
      if (!created.payment?.clientSecret) {
        await finalizeOrder(created.orderId);
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
    if (!checkout || pendingRef.current || holdExpired) return;
    if (!checkout.payment?.clientSecret) {
      pendingRef.current = true;
      setPending(true);
      setError(null);
      try {
        await finalizeOrder(checkout.orderId);
      } catch (requestError) {
        setError(
          requestError instanceof ApiRequestError
            ? requestError.body.message
            : "Ticket confirmation could not be completed.",
        );
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
      return;
    }
    if (!stripeRef.current || !elementsRef.current || !paymentElementReady) return;
    await confirmAndFinalize(stripeRef.current, elementsRef.current, checkout.orderId);
  }

  async function retryReceipt() {
    if (!confirmation || receiptRetryPendingRef.current) return;
    receiptRetryPendingRef.current = true;
    setReceiptRetryPending(true);
    setReceiptRetryMessage(null);
    const requestId = receiptRetryRequestIdRef.current ?? crypto.randomUUID();
    receiptRetryRequestIdRef.current = requestId;
    try {
      const result = await apiFetch<{
        receiptDelivery: "SENT" | "FAILED" | "NOT_REQUESTED";
        email: string;
      }>(`/ticketing/orders/${confirmation.orderId}/receipt`, {
        method: "POST",
        body: JSON.stringify({ holderKey, requestId }),
      });
      if (result.receiptDelivery === "SENT") receiptRetryRequestIdRef.current = null;
      setConfirmation((current) => current ? { ...current, receiptDelivery: result.receiptDelivery } : current);
      setReceiptRetryMessage(
        result.receiptDelivery === "SENT"
          ? `Your tickets were sent to ${result.email}.`
          : "The email still could not be sent. Keep these QR tickets for admission and try again.",
      );
    } catch (requestError) {
      setReceiptRetryMessage(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : "The ticket email could not be retried.",
      );
    } finally {
      receiptRetryPendingRef.current = false;
      setReceiptRetryPending(false);
    }
  }

  function printConfirmation() {
    document.body.classList.add("ticket-confirmation-printing");
    const cleanup = () => document.body.classList.remove("ticket-confirmation-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  if (confirmation) {
    return (
      <section className="ticket-confirmation ticket-confirmation--printable">
        <span className="eyebrow">ORDER CONFIRMED</span>
        <h2>See you at the movies.</h2>
        <p>
          Confirmation <strong>{confirmation.orderNumber}</strong> is ready.
          {confirmation.receiptDelivery === "SENT"
            ? ` A receipt with your QR tickets was sent to ${email}.`
            : " Save these tickets for admission."}
        </p>
        {confirmation.receiptDelivery === "FAILED" && (
          <p>
            <button
              className="account-secondary-button"
              type="button"
              disabled={receiptRetryPending}
              onClick={() => void retryReceipt()}
            >
              {receiptRetryPending ? "Sending…" : "Retry ticket email"}
            </button>
          </p>
        )}
        {confirmation.smsDelivery === "SENT" && (
          <p>Your mobile tickets were also sent by text.</p>
        )}
        {confirmation.smsDelivery === "FAILED" && (
          <p role="status">
            We couldn&apos;t send the text message. Your tickets are available below, and your email receipt remains available.
          </p>
        )}
        {receiptRetryMessage && <p role="status">{receiptRetryMessage}</p>}
        {confirmation.diningAuthorization === "AUTHORIZED" && (
          <p>Your saved card is authorized for food and drinks during this visit.</p>
        )}
        {confirmation.tickets.map((ticket) => (
          <div className="confirmation-card digital-ticket" key={ticket.id}>
            <div>
              <h3>{ticket.movie}</h3>
              <p>{new Intl.DateTimeFormat("en-US", {
                timeZone,
                weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
              }).format(new Date(ticket.startsAt))}</p>
              <p>{ticket.auditorium} · Seat {ticket.seat}</p>
              <p>{ticket.ticketType}</p>
            </div>
            <div className="ticket-qr" aria-label={`Admission QR code for seat ${ticket.seat}`}>
              <QRCodeSVG value={ticket.issuanceToken} size={180} level="M" marginSize={2} />
            </div>
          </div>
        ))}
        <strong>{money(confirmation.totalCents, confirmation.currency)}</strong>
        <div className="ticket-confirmation__actions">
          <button className="account-secondary-button" type="button" onClick={printConfirmation}>
            Print tickets
          </button>
          <button
            className="account-secondary-button"
            type="button"
            onClick={() => downloadTicketCalendar(
              confirmation.orderNumber,
              confirmation.tickets.map((ticket) => ({
                id: ticket.id,
                movie: ticket.movie,
                auditorium: ticket.auditorium,
                seat: ticket.seat,
                startsAt: ticket.startsAt,
                endsAt: ticket.endsAt,
              })),
            )}
          >
            Add to calendar
          </button>
          <a className="primary-link" href={accountRecognized ? "/account" : "/account?createAccount=1"}>{accountRecognized ? "View tickets in my account" : "Create an account to save my tickets"}</a>
        </div>
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
          {new Intl.DateTimeFormat("en-US", {
            timeZone,
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(startsAt))} · {auditorium}
        </p>
        <p>{generalAdmission ? `General admission × ${seats.length}` : seats.join(", ")}</p>
        <div className="hold-clock" aria-live="polite">
          <span>{holdRemainingSeconds > 0 ? "Tickets held" : "Hold expired"}</span>
          <strong>
            {Math.floor(holdRemainingSeconds / 60)}:{String(holdRemainingSeconds % 60).padStart(2, "0")}
          </strong>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {holdExpired && (
        <div className="checkout-panel hold-expired-panel" role="alert">
          <h3>Your ticket hold has expired</h3>
          <p>
            {paymentConfirmed
              ? "Your payment was submitted before the hold expired. It is being reconciled automatically, and it will be refunded if tickets cannot be issued."
              : "Payment is now disabled and no new payment will be submitted. Return to seat selection to check current availability and start a new hold."}
          </p>
          <button className="primary" type="button" onClick={onBack}>
            Choose seats again
          </button>
        </div>
      )}
      {!config && error && !checkout && (
        <button className="link" type="button" disabled={configLoading} onClick={() => void loadConfig()}>
          {configLoading ? "Retrying checkout…" : "Retry checkout setup"}
        </button>
      )}
      {resumeLoading && !checkout && !holdExpired ? (
        <div className="checkout-panel"><h3>Resuming secure checkout…</h3></div>
      ) : !checkout && !holdExpired ? (
        <form className="checkout-form" onSubmit={beginCheckout}>
          <div className="checkout-panel">
            <h3>Receipt</h3>
            {accountRecognized && <p className="configuration-note">This purchase will be saved to your signed-in account. You can change the receipt name for this order.</p>}
            <label className="field">
              <span>Name</span>
              <input autoComplete="name" value={name} onChange={(event) => { nameDirtyRef.current = true; setName(event.target.value); }} />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                value={email}
                autoComplete="email"
                readOnly={accountRecognized}
                aria-describedby={accountRecognized ? "signed-in-checkout-email-note" : undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
              {accountRecognized && <small id="signed-in-checkout-email-note">Sign out from Account to purchase under a different email.</small>}
            </label>
            {config?.notifications.smsTicketsAvailable && (
              <div className="sms-ticket-choice">
                <label>
                  <input
                    type="checkbox"
                    checked={smsTicketsRequested}
                    onChange={(event) => setSmsTicketsRequested(event.target.checked)}
                  />
                  <span>Text my mobile tickets</span>
                </label>
                {smsTicketsRequested && (
                  <label className="field">
                    <span>Mobile number</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      value={phone}
                      placeholder="(555) 555-0123"
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                )}
                <small>
                  By selecting this option, you agree to receive one transactional text for this order. Message and data rates may apply. No marketing messages.
                </small>
              </div>
            )}
            <label className="field">
              <span>Promotion code</span>
              <input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} autoComplete="off" />
            </label>
            <label className="field">
              <span>Gift card code</span>
              <input value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value.toUpperCase())} autoComplete="off" />
            </label>
          </div>
          {config?.orderAhead.available && (
            <div className="checkout-panel order-ahead-panel">
              <div className="order-ahead-heading">
                <div>
                  <span className="eyebrow">OPTIONAL</span>
                  <h3>Order food + drinks ahead</h3>
                </div>
                <button
                  className="link"
                  type="button"
                  onClick={() => {
                    setOrderAheadOpen((open) => {
                      if (!open && !openOrderAheadCategoryId) setOpenOrderAheadCategoryId(config.orderAhead.categories[0]?.id ?? null);
                      return !open;
                    });
                  }}
                  aria-expanded={orderAheadOpen}
                >
                  {orderAheadOpen ? "Hide menu" : "View menu"}
                </button>
              </div>
              <p>Add items now and pay once with your tickets. Your order will be linked to these seats.</p>
              {orderAheadOpen && (
                <div className="order-ahead-menu">
                  {config.orderAhead.categories.map((category) => {
                    const categoryIsOpen = openOrderAheadCategoryId === category.id;
                    return <section key={category.id} className="order-ahead-category">
                      <button type="button" className="order-ahead-category__toggle" aria-expanded={categoryIsOpen} aria-controls={`order-ahead-category-${category.id}`} onClick={() => setOpenOrderAheadCategoryId(categoryIsOpen ? null : category.id)}>
                        <span>{category.name}</span>
                        <small>{category.items.length} {category.items.length === 1 ? "item" : "items"}</small>
                      </button>
                      {categoryIsOpen && <div className="order-ahead-category__items" id={`order-ahead-category-${category.id}`}>{category.items.map((item) => {
                        const selection = orderAheadSelections[item.id];
                        return (
                          <article className="order-ahead-item" key={item.id}>
                            <div className="order-ahead-item__summary">
                              <div>
                                <strong>{item.name}</strong>
                                {item.description && <p>{item.description}</p>}
                                <small>{money(item.priceCents, config.currency)}</small>
                              </div>
                              <div className="quantity-control" aria-label={`Quantity for ${item.name}`}>
                                <button type="button" onClick={() => setOrderAheadQuantity(item.id, (selection?.quantity ?? 0) - 1)} aria-label={`Remove one ${item.name}`}>−</button>
                                <span>{selection?.quantity ?? 0}</span>
                                <button type="button" onClick={() => setOrderAheadQuantity(item.id, (selection?.quantity ?? 0) + 1)} aria-label={`Add one ${item.name}`}>+</button>
                              </div>
                            </div>
                            {selection && item.modifierGroups.map((group) => (
                              <fieldset className="modifier-group" key={group.id}>
                                <legend>
                                  {group.name}
                                  {(group.required || group.minSelections > 0) && <small> Required</small>}
                                </legend>
                                {group.modifiers.map((modifier) => (
                                  <label key={modifier.id}>
                                    <input
                                      type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                                      name={`modifier-${item.id}-${group.id}`}
                                      checked={selection.modifierIds.includes(modifier.id)}
                                      onChange={() => toggleOrderAheadModifier(
                                        item.id,
                                        modifier.id,
                                        group.selectionType,
                                        group.modifiers.map((entry) => entry.id),
                                        group.maxSelections,
                                      )}
                                    />
                                    <span>{modifier.name}</span>
                                    {modifier.priceDeltaCents !== 0 && <small>+{money(modifier.priceDeltaCents, config.currency)}</small>}
                                  </label>
                                ))}
                              </fieldset>
                            ))}
                          </article>
                        );
                      })}</div>}
                    </section>;
                  })}
                </div>
              )}
              {selectedOrderAheadItems.length > 0 && (
                <p className="order-ahead-estimate">
                  <span>Food + drink subtotal</span>
                  <strong>{money(orderAheadEstimateCents, config.currency)}</strong>
                  <small>Tax and any configured service charge are calculated securely at checkout.</small>
                </p>
              )}
              {!orderAheadSelectionIsValid() && (
                <p className="order-ahead-validation" role="alert">
                  Complete the required food and drink choices before continuing.
                </p>
              )}
            </div>
          )}
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
          {configShowtimeId === showtimeId && config && !config.payment.ready && (
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
              configShowtimeId !== showtimeId ||
              diningAuthorization === null ||
              !orderAheadSelectionIsValid() ||
              !config ||
              !selectedTicketTypeId ||
              holdRemainingSeconds === 0 ||
              holdTokens.some((holdToken) => !ticketTypeByHoldToken[holdToken]) ||
              (!config.payment.ready && !giftCardCode.trim())
            }
          >
            {pending ? "Preparing secure checkout…" : "Continue to payment"}
          </button>
        </form>
      ) : checkout && !holdExpired ? (
        <form className="payment-form" onSubmit={pay}>
          <div className="checkout-panel order-total">
            <h3>Order</h3>
            <p><span>Tickets ({seats.length})</span><strong>{money(checkout.subtotalCents, checkout.currency)}</strong></p>
            {checkout.discountCents > 0 && <p><span>Promotion{checkout.promotion ? ` · ${checkout.promotion.name} (${checkout.promotion.code})` : ""}</span><strong>−{money(checkout.discountCents, checkout.currency)}</strong></p>}
            <p><span>Service fee</span><strong>{money(checkout.feesCents, checkout.currency)}</strong></p>
            <p><span>Tax</span><strong>{money(checkout.taxCents, checkout.currency)}</strong></p>
            {checkout.orderAheadSubtotalCents > 0 && <p><span>Food + drinks</span><strong>{money(checkout.orderAheadSubtotalCents, checkout.currency)}</strong></p>}
            {checkout.orderAheadTaxCents > 0 && <p><span>Food + drink tax</span><strong>{money(checkout.orderAheadTaxCents, checkout.currency)}</strong></p>}
            {checkout.orderAheadServiceChargeCents > 0 && <p><span>Food + drink service charge</span><strong>{money(checkout.orderAheadServiceChargeCents, checkout.currency)}</strong></p>}
            {checkout.giftCardCents > 0 && <p><span>Gift card</span><strong>−{money(checkout.giftCardCents, checkout.currency)}</strong></p>}
            <p className="total"><span>Total</span><strong>{money(checkout.totalCents, checkout.currency)}</strong></p>
          </div>
          {checkout.payment?.clientSecret ? <div className="checkout-panel">
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
          </div> : <div className="checkout-panel"><h3>Payment complete</h3><p>Your gift card covers this order. Complete confirmation to receive your tickets.</p></div>}
          <button className="primary" disabled={pending || holdExpired || (Boolean(checkout.payment?.clientSecret) && !paymentElementReady)}>
            {pending
              ? "Completing purchase…"
              : !checkout.payment?.clientSecret
                ? "Complete ticket confirmation"
              : paymentConfirmed
                ? "Complete ticket confirmation"
              : !paymentElementReady
                ? "Loading secure payment…"
              : `Pay ${money(checkout.payment?.amountCents ?? checkout.totalCents, checkout.currency)}`}
          </button>
        </form>
      ) : null}
    </section>
  );
}
