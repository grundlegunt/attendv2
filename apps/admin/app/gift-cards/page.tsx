"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type GiftCardTransaction = { id: string; type: "ISSUANCE" | "REDEMPTION" | "REFUND" | "ADJUSTMENT"; amountCents: number; balanceAfterCents: number; reference: string | null; createdAt: string; location: { name: string }; employee: { name: string } | null };
type GiftCard = { id: string; codeLast4: string; initialBalanceCents: number; balanceCents: number; currency: string; recipientName: string | null; recipientEmail: string | null; status: string; createdAt: string; issuedAtLocation?: { name: string }; transactions: GiftCardTransaction[] };
type IssuedGiftCard = GiftCard & { code: string };

function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }

export default function GiftCardsPage() {
  const { accessToken } = useAdminSession();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [amount, setAmount] = useState("25.00");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [issued, setIssued] = useState<IssuedGiftCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingStatusCardId, setPendingStatusCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionPendingRef = useRef(false);
  const issuanceKey = useRef(crypto.randomUUID());
  const statusAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      setCards(await apiFetch<GiftCard[]>("/management/gift-cards", { accessToken, signal }));
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof ApiRequestError ? requestError.body.message : "Gift cards could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accessToken]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function changeIssuanceDetail(setter: (value: string) => void, value: string) {
    issuanceKey.current = crypto.randomUUID();
    setter(value);
  }

  async function issue(event: FormEvent) {
    event.preventDefault(); setError(null); setIssued(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 500 || amountCents > 100_000) {
      setError("Enter a gift card amount from $5.00 to $1,000.00.");
      return;
    }
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    setSaving(true);
    try {
      const card = await apiFetch<IssuedGiftCard>("/management/gift-cards", { accessToken, method: "POST", headers: { "Idempotency-Key": issuanceKey.current }, body: JSON.stringify({ amountCents, recipientName: recipientName || undefined, recipientEmail: recipientEmail || undefined }) });
      issuanceKey.current = crypto.randomUUID(); setIssued(card); setAmount("25.00"); setRecipientName(""); setRecipientEmail(""); await load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.body.message : "Gift card could not be issued.");
    } finally {
      actionPendingRef.current = false;
      setSaving(false);
    }
  }

  async function updateStatus(card: GiftCard) {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    setPendingStatusCardId(card.id);
    setError(null);
    const status = card.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    const body = JSON.stringify({ status });
    const fingerprint = `${card.id}:${body}`;
    if (statusAttemptRef.current?.fingerprint !== fingerprint) statusAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/gift-cards/${card.id}/status`, { accessToken, method: "PATCH", headers: { "Idempotency-Key": statusAttemptRef.current.requestId }, body });
      statusAttemptRef.current = null;
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status } : item));
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status < 500) statusAttemptRef.current = null;
      setError(requestError instanceof ApiRequestError ? requestError.body.message : "Gift card status could not be updated.");
    } finally {
      actionPendingRef.current = false;
      setPendingStatusCardId(null);
    }
  }

  const actionPending = saving || pendingStatusCardId !== null;
  return <main className="admin-route-page"><section className="panel"><p className="kicker">GIFT CARDS</p><h2>Issue a gift card</h2><p>The full code is shown once. Store or deliver it securely.</p>{error && <p className="error-banner">{error}</p>}{issued && <div className="configuration-note"><strong>{issued.code}</strong><p>{money(issued.balanceCents, issued.currency)} issued. This code will not be shown again.</p></div>}<form className="filter-grid" onSubmit={issue}><label>Amount<input type="number" min="5" max="1000" step="0.01" required value={amount} disabled={actionPending} onChange={(event) => changeIssuanceDetail(setAmount, event.target.value)} /></label><label>Recipient name<input value={recipientName} maxLength={120} disabled={actionPending} onChange={(event) => changeIssuanceDetail(setRecipientName, event.target.value)} /></label><label>Recipient email<input type="email" value={recipientEmail} disabled={actionPending} onChange={(event) => changeIssuanceDetail(setRecipientEmail, event.target.value)} /></label><button className="primary" type="submit" disabled={actionPending}>{saving ? "Issuing…" : "Issue gift card"}</button></form></section><section className="panel"><h2>Issued cards</h2><div className="audit-list">{cards.map((card) => <article className="audit-event" key={card.id}><div className="management-heading"><div><strong>Gift card •••• {card.codeLast4}</strong><small>{card.recipientName || "No recipient name"}{card.recipientEmail ? ` · ${card.recipientEmail}` : ""}</small></div><div><strong>{money(card.balanceCents, card.currency)}</strong><button className="secondary" type="button" disabled={actionPending} onClick={() => void updateStatus(card)}>{pendingStatusCardId === card.id ? "Updating…" : card.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</button></div></div><small>Issued {money(card.initialBalanceCents, card.currency)} at {card.issuedAtLocation?.name || "this theater"} · {new Date(card.createdAt).toLocaleString()} · {card.status}</small><details><summary>Recent activity ({card.transactions.length})</summary><div className="audit-list">{card.transactions.map((transaction) => <div className="audit-event" key={transaction.id}><div className="management-heading"><strong>{transaction.type}</strong><strong>{transaction.amountCents > 0 ? "+" : ""}{money(transaction.amountCents, card.currency)}</strong></div><small>{new Date(transaction.createdAt).toLocaleString()} · {transaction.location.name} · {transaction.employee?.name || "System"} · Balance {money(transaction.balanceAfterCents, card.currency)}{transaction.reference ? ` · Ref ${transaction.reference}` : ""}</small></div>)}</div></details></article>)}{loading ? <p>Loading gift cards…</p> : !error && cards.length === 0 ? <p>No gift cards issued yet.</p> : null}</div></section></main>;
}
