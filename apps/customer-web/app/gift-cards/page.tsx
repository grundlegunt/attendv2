"use client";

import { FormEvent, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Balance = { codeLast4: string; balanceCents: number; currency: string };

function money(cents: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }

export default function GiftCardsPage() {
  const [code, setCode] = useState("");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState("");

  async function checkBalance(event: FormEvent) {
    event.preventDefault(); setError(""); setBalance(null);
    try {
      setBalance(await apiFetch<Balance>("/cinema/gift-cards/balance", { method: "POST", body: JSON.stringify({ code }) }));
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "Gift card balance is temporarily unavailable.");
    }
  }

  return <main className="cinema-shell route-page"><section className="route-heading"><span className="eyebrow">GIFT CARDS</span><h1>Give a night at the movies</h1><p>Gift cards can be used across this theater&apos;s locations. Enter the full card code below to check its current balance.</p></section><form className="private-event-form content-panel" onSubmit={checkBalance}><h2>Check a balance</h2><label>Gift card code<input required minLength={20} maxLength={40} autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ATGC-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /></label><button className="primary">Check balance</button>{balance && <div className="configuration-note"><strong>{money(balance.balanceCents, balance.currency)}</strong><p>Available on gift card ending in {balance.codeLast4}.</p></div>}{error && <p className="error-banner">{error}</p>}</form></main>;
}
