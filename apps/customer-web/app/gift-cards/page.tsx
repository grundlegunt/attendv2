"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Balance = { codeLast4: string; balanceCents: number; currency: string };
type Config = { locationId: string; currency: string; payment: { ready: boolean; publishableKey: string | null; connectedAccountId: string | null } };
type Purchase = { purchaseId: string; amountCents: number; currency: string; payment: { clientSecret?: string } };
type Confirmation = { status: string; amountCents: number; currency: string; code: string | null; codeLast4: string };
type StripeElement = { mount(target: HTMLElement): void; unmount(): void; on(event: "ready", handler: () => void): void };
type StripeElements = { create(type: "payment"): StripeElement };
type StripeClient = { elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements; confirmPayment(options: { elements: StripeElements; redirect: "if_required"; confirmParams: { receipt_email: string } }): Promise<{ error?: { message?: string } }> };

function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
function stripeFactory() { return (window as unknown as { Stripe?: (key: string, options?: { stripeAccount?: string }) => StripeClient }).Stripe; }
async function loadStripe() { if (stripeFactory()) return; await new Promise<void>((resolve, reject) => { const script = document.createElement("script"); script.src = "https://js.stripe.com/v3/"; script.async = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("Stripe could not load.")); document.head.appendChild(script); }); }

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
  const [error, setError] = useState("");
  const [configError, setConfigError] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const paymentRef = useRef<HTMLDivElement>(null);
  const purchaseKey = useRef<string | null>(null);

  useEffect(() => { setConfigError(""); apiFetch<Config>("/gift-card-purchases/config").then(setConfig).catch(() => setConfigError("Gift card purchasing is temporarily unavailable.")); }, [configAttempt]);
  useEffect(() => { if (!elements || !paymentRef.current) return; const element = elements.create("payment"); element.on("ready", () => setPaymentReady(true)); element.mount(paymentRef.current); return () => element.unmount(); }, [elements]);

  function failure(reason: unknown) { return reason instanceof ApiRequestError ? reason.body.message : reason instanceof Error ? reason.message : "The request could not be completed."; }
  async function startPurchase(event: FormEvent) {
    event.preventDefault(); if (!config) return; setPending(true); setError("");
    try {
      if (!purchaseKey.current) purchaseKey.current = crypto.randomUUID();
      const created = await apiFetch<Purchase>("/gift-card-purchases", { method: "POST", headers: { "Idempotency-Key": purchaseKey.current }, body: JSON.stringify({ locationId: config.locationId, amountCents: Math.round(Number(amount) * 100), buyerEmail, recipientName: recipientName || undefined, recipientEmail, message: message || undefined }) });
      if (!created.payment.clientSecret) throw new Error("A secure payment session could not be created.");
      await loadStripe(); const factory = stripeFactory(); if (!factory || !config.payment.publishableKey) throw new Error("Stripe payments are not configured.");
      const stripe = factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined });
      setPurchase(created); setElements(stripe.elements({ clientSecret: created.payment.clientSecret, appearance: { theme: "night" } }));
    } catch (reason) { setError(failure(reason)); } finally { setPending(false); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault(); const factory = stripeFactory(); if (!purchase || !elements || !factory || !config?.payment.publishableKey) return; setPending(true); setError("");
    try {
      const stripe = factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined });
      const result = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { receipt_email: buyerEmail } });
      if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
      setConfirmation(await apiFetch<Confirmation>(`/gift-card-purchases/${purchase.purchaseId}/finalize`, { method: "POST", body: "{}" }));
    } catch (reason) { setError(failure(reason)); } finally { setPending(false); }
  }
  async function checkBalance(event: FormEvent) { event.preventDefault(); setError(""); setBalance(null); try { setBalance(await apiFetch<Balance>("/cinema/gift-cards/balance", { method: "POST", body: JSON.stringify({ code }) })); } catch (reason) { setError(failure(reason)); } }

  return <main className="cinema-shell route-page"><section className="route-heading"><span className="eyebrow">GIFT CARDS</span><h1>Give a night at the movies</h1><p>Purchase a gift card for delivery to someone special, or check an existing balance.</p></section>{confirmation ? <section className="content-panel"><h2>Gift card purchased</h2><p>{money(confirmation.amountCents, confirmation.currency)} is ready for {recipientEmail}.</p>{confirmation.code && <div className="configuration-note"><strong>{confirmation.code}</strong><p>Save this code now. Email delivery will also send it to the recipient.</p></div>}</section> : !purchase ? <form className="private-event-form content-panel" onSubmit={startPurchase}><h2>Purchase a gift card</h2><label>Amount<input type="number" min="5" max="1000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Your email<input type="email" required value={buyerEmail} onChange={(event) => setBuyerEmail(event.target.value)} /></label><label>Recipient name<input value={recipientName} maxLength={120} onChange={(event) => setRecipientName(event.target.value)} /></label><label>Recipient email<input type="email" required value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} /></label><label>Message<textarea maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} /></label><button className="primary" disabled={pending || !config?.payment.ready}>{pending ? "Preparing checkout…" : "Continue to payment"}</button>{configError && <><p className="error-banner">{configError}</p><button className="primary" type="button" onClick={() => setConfigAttempt((attempt) => attempt + 1)}>Retry gift card setup</button></>}</form> : <form className="content-panel" onSubmit={pay}><h2>Secure payment</h2><p>{money(purchase.amountCents, purchase.currency)} gift card for {recipientEmail}</p><div ref={paymentRef} /><button className="primary" disabled={pending || !paymentReady}>{pending ? "Completing purchase…" : `Pay ${money(purchase.amountCents, purchase.currency)}`}</button></form>}{error && <p className="error-banner">{error}</p>}<form className="private-event-form content-panel" onSubmit={checkBalance}><h2>Check a balance</h2><label>Gift card code<input required minLength={20} maxLength={40} autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ATGC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /></label><button className="primary">Check balance</button>{balance && <div className="configuration-note"><strong>{money(balance.balanceCents, balance.currency)}</strong><p>Available on gift card ending in {balance.codeLast4}.</p></div>}</form></main>;
}
