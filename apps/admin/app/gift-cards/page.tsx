"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type GiftCard = { id: string; codeLast4: string; initialBalanceCents: number; balanceCents: number; currency: string; recipientName: string | null; recipientEmail: string | null; status: string; createdAt: string; issuedAtLocation?: { name: string } };
type IssuedGiftCard = GiftCard & { code: string };

function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }

export default function GiftCardsPage() {
  const { accessToken } = useAdminSession();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [amount, setAmount] = useState("25.00");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [issued, setIssued] = useState<IssuedGiftCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => void apiFetch<GiftCard[]>("/management/gift-cards", { accessToken }).then(setCards);
  useEffect(load, [accessToken]);

  async function issue(event: FormEvent) {
    event.preventDefault(); setError(null); setIssued(null);
    try {
      const amountCents = Math.round(Number(amount) * 100);
      const card = await apiFetch<IssuedGiftCard>("/management/gift-cards", { accessToken, method: "POST", body: JSON.stringify({ amountCents, recipientName: recipientName || undefined, recipientEmail: recipientEmail || undefined }) });
      setIssued(card); setAmount("25.00"); setRecipientName(""); setRecipientEmail(""); load();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.body.message : "Gift card could not be issued.");
    }
  }

  async function updateStatus(card: GiftCard) {
    setError(null);
    try {
      const status = card.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
      await apiFetch(`/management/gift-cards/${card.id}/status`, { accessToken, method: "PATCH", body: JSON.stringify({ status }) });
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status } : item));
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.body.message : "Gift card status could not be updated.");
    }
  }

  return <main className="admin-route-page"><section className="panel"><p className="kicker">GIFT CARDS</p><h2>Issue a gift card</h2><p>The full code is shown once. Store or deliver it securely.</p>{error && <p className="error-banner">{error}</p>}{issued && <div className="configuration-note"><strong>{issued.code}</strong><p>{money(issued.balanceCents, issued.currency)} issued. This code will not be shown again.</p></div>}<form className="filter-grid" onSubmit={issue}><label>Amount<input type="number" min="5" max="1000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Recipient name<input value={recipientName} maxLength={120} onChange={(event) => setRecipientName(event.target.value)} /></label><label>Recipient email<input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} /></label><button className="primary" type="submit">Issue gift card</button></form></section><section className="panel"><h2>Issued cards</h2><div className="audit-list">{cards.map((card) => <article className="audit-event" key={card.id}><div className="management-heading"><div><strong>Gift card •••• {card.codeLast4}</strong><small>{card.recipientName || "No recipient name"}{card.recipientEmail ? ` · ${card.recipientEmail}` : ""}</small></div><div><strong>{money(card.balanceCents, card.currency)}</strong><button className="secondary" type="button" onClick={() => void updateStatus(card)}>{card.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</button></div></div><small>Issued {money(card.initialBalanceCents, card.currency)} at {card.issuedAtLocation?.name || "this theater"} · {new Date(card.createdAt).toLocaleString()} · {card.status}</small></article>)}{cards.length === 0 && <p>No gift cards issued yet.</p>}</div></section></main>;
}
