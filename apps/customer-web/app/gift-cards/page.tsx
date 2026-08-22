"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { loadStripeScript } from "../lib/stripe-loader";

type Balance = { codeLast4: string; balanceCents: number; currency: string };
type Config = { locationId: string; currency: string; payment: { ready: boolean; publishableKey: string | null; connectedAccountId: string | null } };
type Purchase = { purchaseId: string; amountCents: number; currency: string; buyerEmail: string; recipientEmail: string; payment: { status: string; clientSecret?: string } };
type Confirmation = { status: string; amountCents: number; currency: string; code: string | null; codeLast4: string };
type StripeElement = { mount(target: HTMLElement): void; unmount(): void; on(event: "ready", handler: () => void): void };
type StripeElements = { create(type: "payment"): StripeElement };
type StripeClient = { elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements; confirmPayment(options: { elements: StripeElements; redirect: "if_required"; confirmParams: { receipt_email: string } }): Promise<{ error?: { message?: string } }> };
const PURCHASE_STORAGE_KEY = "attend-gift-card-purchase";
const PAYMENT_STATUS_POLL_LIMIT = 10;

function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
function stripeFactory() { return (window as unknown as { Stripe?: (key: string, options?: { stripeAccount?: string }) => StripeClient }).Stripe; }

export default function GiftCardsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [amount, setAmount] = useState("25.00");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balancePending, setBalancePending] = useState(false);
  const [error, setError] = useState("");
  const [configError, setConfigError] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const paymentRef = useRef<HTMLDivElement>(null);
  const purchaseKey = useRef<string | null>(null);
  const resumeAttempted = useRef(false);
  const balanceRequestRef = useRef<AbortController | null>(null);
  const purchaseActionPendingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setConfigError("");
    apiFetch<Config>("/gift-card-purchases/config", { signal: controller.signal })
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfigError("Gift card purchasing is temporarily unavailable.");
      });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => () => balanceRequestRef.current?.abort(), []);
  useEffect(() => { if (!elements || !paymentRef.current) return; const element = elements.create("payment"); element.on("ready", () => setPaymentReady(true)); element.mount(paymentRef.current); return () => element.unmount(); }, [elements]);
  useEffect(() => {
    if (!config || resumeAttempted.current) return;
    let active = true;
    resumeAttempted.current = true;
    const storedKey = window.sessionStorage.getItem(PURCHASE_STORAGE_KEY);
    if (!storedKey) return;
    purchaseKey.current = storedKey;
    setPending(true); setError("");
    apiFetch<Purchase>("/gift-card-purchases/resume", { method: "POST", headers: { "Idempotency-Key": storedKey }, body: "{}" })
      .then(async (initialResume) => {
        let resumed = initialResume;
        let processingPolls = 0;
        while (active && resumed.payment.status === "PROCESSING") {
          setPurchase(resumed);
          if (processingPolls >= PAYMENT_STATUS_POLL_LIMIT) {
            throw new Error("Payment is still processing. Please wait a moment, then refresh this page.");
          }
          processingPolls += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          if (!active) return;
          resumed = await apiFetch<Purchase>("/gift-card-purchases/resume", { method: "POST", headers: { "Idempotency-Key": storedKey }, body: "{}" });
        }
        if (!active) return;
        setBuyerEmail(resumed.buyerEmail); setRecipientEmail(resumed.recipientEmail);
        if (resumed.payment.status === "SUCCEEDED") {
          setConfirmation(await finalizePurchase(resumed.purchaseId, storedKey));
          window.sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
          return;
        }
        if (!resumed.payment.clientSecret) throw new Error("A secure payment session could not be resumed.");
        await loadStripeScript(); const factory = stripeFactory(); if (!factory || !config.payment.publishableKey) throw new Error("Stripe payments are not configured.");
        setPurchase(resumed);
        setElements(factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined }).elements({ clientSecret: resumed.payment.clientSecret, appearance: { theme: "night" } }));
      })
      .catch((reason) => { if (!active) return; if (reason instanceof ApiRequestError && reason.status === 404) { window.sessionStorage.removeItem(PURCHASE_STORAGE_KEY); purchaseKey.current = null; } setError(failure(reason)); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [config]);

  function failure(reason: unknown) { return reason instanceof ApiRequestError ? reason.body.message : reason instanceof Error ? reason.message : "The request could not be completed."; }
  function finalizePurchase(purchaseId: string, key: string) {
    return apiFetch<Confirmation>(`/gift-card-purchases/${purchaseId}/finalize`, { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" });
  }
  function changePurchaseDetail(setter: (value: string) => void, value: string) {
    purchaseKey.current = null;
    window.sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
    setter(value);
  }
  async function startPurchase(event: FormEvent) {
    event.preventDefault();
    if (!config || purchaseActionPendingRef.current) return;
    purchaseActionPendingRef.current = true;
    setPending(true); setError("");
    try {
      if (!purchaseKey.current) purchaseKey.current = crypto.randomUUID();
      window.sessionStorage.setItem(PURCHASE_STORAGE_KEY, purchaseKey.current);
      const created = await apiFetch<Purchase>("/gift-card-purchases", { method: "POST", headers: { "Idempotency-Key": purchaseKey.current }, body: JSON.stringify({ locationId: config.locationId, amountCents: Math.round(Number(amount) * 100), buyerEmail, recipientName: recipientName || undefined, recipientEmail, message: message || undefined }) });
      if (!created.payment.clientSecret) throw new Error("A secure payment session could not be created.");
      await loadStripeScript(); const factory = stripeFactory(); if (!factory || !config.payment.publishableKey) throw new Error("Stripe payments are not configured.");
      const stripe = factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined });
      setPurchase(created); setElements(stripe.elements({ clientSecret: created.payment.clientSecret, appearance: { theme: "night" } }));
    } catch (reason) { setError(failure(reason)); } finally { purchaseActionPendingRef.current = false; setPending(false); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault();
    const factory = stripeFactory();
    if (!purchase || !elements || !factory || !config?.payment.publishableKey || purchaseActionPendingRef.current) return;
    purchaseActionPendingRef.current = true;
    setPending(true); setError("");
    try {
      const stripe = factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined });
      const result = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { receipt_email: buyerEmail } });
      if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
      setConfirmation(await finalizePurchase(purchase.purchaseId, purchaseKey.current!));
      window.sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
    } catch (reason) { setError(failure(reason)); } finally { purchaseActionPendingRef.current = false; setPending(false); }
  }
  async function checkBalance(event: FormEvent) {
    event.preventDefault();
    if (balanceRequestRef.current) return;
    const controller = new AbortController();
    balanceRequestRef.current = controller;
    setBalancePending(true);
    setError("");
    setBalance(null);
    try {
      const next = await apiFetch<Balance>("/cinema/gift-cards/balance", {
        method: "POST",
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
      if (balanceRequestRef.current === controller) setBalance(next);
    } catch (reason) {
      if (!controller.signal.aborted) setError(failure(reason));
    } finally {
      if (balanceRequestRef.current === controller) {
        balanceRequestRef.current = null;
        setBalancePending(false);
      }
    }
  }
  function changeBalanceCode(value: string) {
    balanceRequestRef.current?.abort();
    balanceRequestRef.current = null;
    setBalancePending(false);
    setBalance(null);
    setError("");
    setCode(value.toUpperCase());
  }

  return <main className="cinema-shell route-page"><section className="route-heading"><span className="eyebrow">GIFT CARDS</span><h1>Give a night at the movies</h1><p>Purchase a gift card for delivery to someone special, or check an existing balance.</p></section>{confirmation ? <section className="content-panel"><h2>Gift card purchased</h2><p>{money(confirmation.amountCents, confirmation.currency)} is ready for {recipientEmail}.</p>{confirmation.code && <div className="configuration-note"><strong>{confirmation.code}</strong><p>Save this code now. Email delivery will also send it to the recipient.</p></div>}</section> : !purchase ? <form className="private-event-form content-panel" onSubmit={startPurchase}><h2>Purchase a gift card</h2><label>Amount<input type="number" min="5" max="1000" step="0.01" required value={amount} onChange={(event) => changePurchaseDetail(setAmount, event.target.value)} /></label><label>Your email<input type="email" required value={buyerEmail} onChange={(event) => changePurchaseDetail(setBuyerEmail, event.target.value)} /></label><label>Recipient name<input value={recipientName} maxLength={120} onChange={(event) => changePurchaseDetail(setRecipientName, event.target.value)} /></label><label>Recipient email<input type="email" required value={recipientEmail} onChange={(event) => changePurchaseDetail(setRecipientEmail, event.target.value)} /></label><label>Message<textarea maxLength={500} value={message} onChange={(event) => changePurchaseDetail(setMessage, event.target.value)} /></label><button className="primary" disabled={pending || !config?.payment.ready}>{pending ? "Preparing checkout…" : "Continue to payment"}</button>{configError && <><p className="error-banner">{configError}</p><button className="primary" type="button" onClick={() => setConfigAttempt((attempt) => attempt + 1)}>Retry gift card setup</button></>}</form> : <form className="content-panel" onSubmit={pay}><h2>Secure payment</h2><p>{money(purchase.amountCents, purchase.currency)} gift card for {recipientEmail}</p><div ref={paymentRef} /><button className="primary" disabled={pending || !paymentReady}>{pending ? "Completing purchase…" : `Pay ${money(purchase.amountCents, purchase.currency)}`}</button></form>}{error && <p className="error-banner">{error}</p>}<form className="private-event-form content-panel" onSubmit={checkBalance}><h2>Check a balance</h2><label>Gift card code<input required minLength={20} maxLength={40} autoComplete="off" value={code} onChange={(event) => changeBalanceCode(event.target.value)} placeholder="ATGC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /></label><button className="primary" disabled={balancePending}>{balancePending ? "Checking balance…" : "Check balance"}</button>{balance && <div className="configuration-note"><strong>{money(balance.balanceCents, balance.currency)}</strong><p>Available on gift card ending in {balance.codeLast4}.</p></div>}</form></main>;
}
