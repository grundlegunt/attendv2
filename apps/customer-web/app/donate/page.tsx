"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { loadStripeScript } from "../lib/stripe-loader";
import { trackOptionalAnalyticsEvent } from "../lib/optional-analytics";

type Config = { locationId: string; organizationName: string; currency: string; campaigns: Array<{ id: string; name: string; description: string | null; goalAmountCents: number | null }>; payment: { ready: boolean; publishableKey: string | null; connectedAccountId: string | null } };
type Checkout = { checkoutId: string; amountCents: number; currency: string; donorEmail: string; payment: { status: string; clientSecret?: string } };
type Confirmation = { donationId: string; amountCents: number; currency: string; campaignName: string | null };
type StripeElement = { mount(target: HTMLElement): void; unmount(): void; on(event: "ready", handler: () => void): void };
type StripeElements = { create(type: "payment"): StripeElement };
type StripeClient = { elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements; confirmPayment(options: { elements: StripeElements; redirect: "if_required"; confirmParams: { receipt_email: string } }): Promise<{ error?: { message?: string } }> };
const STORAGE_KEY = "ringo-donation-checkout";
function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
function stripeFactory() { return (window as unknown as { Stripe?: (key: string, options?: { stripeAccount?: string }) => StripeClient }).Stripe; }

export default function DonatePage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [amount, setAmount] = useState("25.00");
  const [campaignId, setCampaignId] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const paymentRef = useRef<HTMLDivElement>(null);
  const checkoutKey = useRef<string | null>(null);
  const resumeAttempted = useRef(false);
  const completionTracked = useRef(false);
  function trackCompletion() { if (completionTracked.current) return; completionTracked.current = true; trackOptionalAnalyticsEvent("Donation Completed"); }

  useEffect(() => { apiFetch<Config>("/donation-checkouts/config").then(setConfig).catch(() => setError("Online contributions are temporarily unavailable.")); }, []);
  useEffect(() => { if (!elements || !paymentRef.current) return; const element = elements.create("payment"); element.on("ready", () => setPaymentReady(true)); element.mount(paymentRef.current); return () => element.unmount(); }, [elements]);
  useEffect(() => {
    if (!config || resumeAttempted.current) return;
    resumeAttempted.current = true;
    const key = window.sessionStorage.getItem(STORAGE_KEY);
    if (!key) return;
    checkoutKey.current = key; setPending(true);
    apiFetch<Checkout>("/donation-checkouts/resume", { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" })
      .then(async (resumed) => {
        setDonorEmail(resumed.donorEmail);
        if (resumed.payment.status === "SUCCEEDED") {
          setConfirmation(await apiFetch<Confirmation>(`/donation-checkouts/${resumed.checkoutId}/finalize`, { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" }));
          trackCompletion();
          window.sessionStorage.removeItem(STORAGE_KEY); return;
        }
        if (!resumed.payment.clientSecret) throw new Error("A secure payment session could not be resumed.");
        await loadStripeScript(); const factory = stripeFactory(); if (!factory || !config.payment.publishableKey) throw new Error("Stripe payments are not configured.");
        setCheckout(resumed); setElements(factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined }).elements({ clientSecret: resumed.payment.clientSecret, appearance: { theme: "night" } }));
      })
      .catch((reason) => { if (reason instanceof ApiRequestError && reason.status === 404) { window.sessionStorage.removeItem(STORAGE_KEY); checkoutKey.current = null; } setError(failure(reason)); })
      .finally(() => setPending(false));
  }, [config]);
  function failure(reason: unknown) { return reason instanceof ApiRequestError ? reason.body.message : reason instanceof Error ? reason.message : "The request could not be completed."; }
  function resetKey() { checkoutKey.current = null; window.sessionStorage.removeItem(STORAGE_KEY); }
  async function start(event: FormEvent) {
    event.preventDefault(); if (!config || pending) return; setPending(true); setError("");
    try {
      checkoutKey.current ||= crypto.randomUUID(); window.sessionStorage.setItem(STORAGE_KEY, checkoutKey.current);
      const created = await apiFetch<Checkout>("/donation-checkouts", { method: "POST", headers: { "Idempotency-Key": checkoutKey.current }, body: JSON.stringify({ locationId: config.locationId, campaignId: campaignId || undefined, amountCents: Math.round(Number(amount) * 100), donorName: donorName || undefined, donorEmail }) });
      if (!created.payment.clientSecret) throw new Error("A secure payment session could not be created.");
      await loadStripeScript(); const factory = stripeFactory(); if (!factory || !config.payment.publishableKey) throw new Error("Stripe payments are not configured.");
      setCheckout(created); setElements(factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined }).elements({ clientSecret: created.payment.clientSecret, appearance: { theme: "night" } }));
      trackOptionalAnalyticsEvent("Donation Checkout Started");
    } catch (reason) { setError(failure(reason)); } finally { setPending(false); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault(); const factory = stripeFactory(); if (!checkout || !elements || !factory || !config?.payment.publishableKey || pending) return; setPending(true); setError("");
    try {
      const stripe = factory(config.payment.publishableKey, { stripeAccount: config.payment.connectedAccountId ?? undefined });
      const result = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { receipt_email: donorEmail } });
      if (result.error) throw new Error(result.error.message ?? "Payment was declined.");
      const confirmed = await apiFetch<Confirmation>(`/donation-checkouts/${checkout.checkoutId}/finalize`, { method: "POST", headers: { "Idempotency-Key": checkoutKey.current! }, body: "{}" });
      setConfirmation(confirmed); trackCompletion(); window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (reason) { setError(failure(reason)); } finally { setPending(false); }
  }

  return <main className="cinema-shell route-page"><section className="route-heading"><span className="eyebrow">SUPPORT THE CINEMA</span><h1>Make a contribution</h1><p>Help sustain independent film, special programs, and community screenings.</p></section>{confirmation ? <section className="content-panel"><h2>Thank you</h2><p>Your {money(confirmation.amountCents, confirmation.currency)} contribution{confirmation.campaignName ? ` to ${confirmation.campaignName}` : ""} is complete. A receipt has been sent to {donorEmail}.</p><p>Reference: {confirmation.donationId}</p></section> : !checkout ? <form className="private-event-form content-panel" onSubmit={start}><h2>Contribution details</h2>{config?.campaigns.length ? <label>Campaign<select value={campaignId} onChange={(event) => { resetKey(); setCampaignId(event.target.value); }}><option value="">General support</option>{config.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label> : null}<label>Amount<input type="number" min="1" max="10000" step="0.01" required value={amount} onChange={(event) => { resetKey(); setAmount(event.target.value); }} /></label><label>Name<input value={donorName} maxLength={120} onChange={(event) => { resetKey(); setDonorName(event.target.value); }} /></label><label>Email<input type="email" required value={donorEmail} onChange={(event) => { resetKey(); setDonorEmail(event.target.value); }} /></label><button className="primary" disabled={pending || !config?.payment.ready}>{pending ? "Preparing checkout…" : "Continue to secure payment"}</button></form> : <form className="content-panel" onSubmit={pay}><h2>Secure payment</h2><p>{money(checkout.amountCents, checkout.currency)} contribution</p><div ref={paymentRef} /><button className="primary" disabled={pending || !paymentReady}>{pending ? "Completing contribution…" : `Contribute ${money(checkout.amountCents, checkout.currency)}`}</button></form>}{error && <p className="error-banner">{error}</p>}</main>;
}
