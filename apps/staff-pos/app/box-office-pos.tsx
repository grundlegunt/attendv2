"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type LiveSeat = Omit<SeatMapSeat, "state"> & { id: string; state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" };
type Quote = { subtotalCents: number; discountCents: number; feesCents: number; taxCents: number; totalCents: number; currency: string; seats: Array<{label:string}> };

export function BoxOfficePos({ accessToken, showtimeId, seats, refresh }: { accessToken: string; showtimeId: string; seats: LiveSeat[]; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [holderKey] = useState(() => `box-office-${crypto.randomUUID()}`);
  const [ticketTypes, setTicketTypes] = useState<Array<{id:string;name:string}>>([]);
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [promotionCode, setPromotionCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [holdTokens, setHoldTokens] = useState<string[]>([]);
  const [registerId, setRegisterId] = useState("BOX-1");
  const [drawer, setDrawer] = useState<{id:string}|null>(null);
  const [openingBalance, setOpeningBalance] = useState("20000");
  const [cashCents, setCashCents] = useState("0");
  const [cardCents, setCardCents] = useState("0");
  const [cashReceived, setCashReceived] = useState("0");
  const [readerId, setReaderId] = useState("tmr_box_1");
  const [message, setMessage] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected([]); setQuote(null); setHoldTokens([]); apiFetch<{ticketTypes:Array<{id:string;name:string}>}>(`/ticketing/showtimes/${showtimeId}/checkout-config`).then((data) => { setTicketTypes(data.ticketTypes); setTicketTypeId(data.ticketTypes[0]?.id ?? ""); }).catch(() => setMessage("Ticket types are unavailable.")); }, [showtimeId]);
  useEffect(() => { apiFetch<{id:string}|null>(`/box-office/cash-drawers/active?registerId=${encodeURIComponent(registerId)}`, { accessToken }).then(setDrawer).catch(() => setDrawer(null)); }, [accessToken, registerId]);

  const mapSeats = useMemo(() => seats.map((seat) => ({ ...seat, state: selected.includes(seat.id) ? "selected" as const : seat.state === "AVAILABLE" ? "available" as const : "unavailable" as const })), [seats, selected]);
  function errorMessage(error: unknown) { return error instanceof ApiRequestError ? error.body.message : "The request could not be completed."; }

  async function openDrawer() {
    setBusy(true); setMessage(null);
    try { setDrawer(await apiFetch("/box-office/cash-drawers", { method: "POST", accessToken, body: JSON.stringify({ registerId, openingBalanceCents: Number(openingBalance) }) })); }
    catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }

  async function prepareSale(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const holds = await apiFetch<Array<{holdToken:string}>>(`/box-office/showtimes/${showtimeId}/holds`, { method: "POST", accessToken, body: JSON.stringify({ seatIds: selected, holderKey }) });
      const tokens = holds.map((hold) => hold.holdToken); setHoldTokens(tokens);
      const next = await apiFetch<Quote>("/box-office/quotes", { method: "POST", accessToken, body: JSON.stringify({ holdTokens: tokens, holderKey, promotionCode: promotionCode || undefined }) });
      setQuote(next); setCardCents(String(next.totalCents)); setCashCents("0");
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }

  async function checkout() {
    if (!quote) return; setBusy(true); setMessage(null);
    try {
      const order = await apiFetch<{orderNumber:string;tickets:Array<unknown>}>("/box-office/checkouts", { method: "POST", accessToken, body: JSON.stringify({ requestId: crypto.randomUUID(), holdTokens, holderKey, ticketTypeId, promotionCode: promotionCode || undefined, cashDrawerId: Number(cashCents) > 0 ? drawer?.id : undefined, cashCents: Number(cashCents), cardCents: Number(cardCents), readerId: Number(cardCents) > 0 ? readerId : undefined, cashReceivedCents: Number(cashCents) > 0 ? Number(cashReceived) : undefined }) });
      setMessage(`Sale complete: ${order.orderNumber} · ${order.tickets.length} ticket(s)`); setSelected([]); setQuote(null); setHoldTokens([]); await refresh();
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }

  return <section className="box-office-grid"><div>
    <h2>Box office</h2><p>Select available seats from the live inventory.</p>
    <SeatMap seats={mapSeats} label="Box office seat map" onSeatClick={(seat) => { const live = seats.find((candidate) => candidate.id === seat.id); if (live?.state !== "AVAILABLE") return; setSelected((current) => current.includes(seat.id!) ? current.filter((id) => id !== seat.id) : [...current, seat.id!]); setQuote(null); }} allowUnavailableSelection />
  </div><aside className="checkout-card">
    {message && <div className={message.startsWith("Sale complete") ? "scan-result valid" : "error-banner"}>{message}</div>}
    <h3>Register</h3><label className="field"><span>Register ID</span><input value={registerId} onChange={(event) => setRegisterId(event.target.value)} /></label>
    {!drawer && <><label className="field"><span>Opening cash (cents)</span><input type="number" min="0" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label><button className="primary" type="button" onClick={openDrawer} disabled={busy}>Open drawer</button></>}
    {drawer && <p className="success-copy">Cash drawer open</p>}
    <form onSubmit={prepareSale}><label className="field"><span>Ticket type</span><select value={ticketTypeId} onChange={(event) => setTicketTypeId(event.target.value)}>{ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label className="field"><span>Promotion code</span><input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} /></label>
      <button className="primary" disabled={!selected.length || !ticketTypeId || busy}>Price {selected.length} seat(s)</button></form>
    {quote && <div className="sale-total"><p>Subtotal ${(quote.subtotalCents/100).toFixed(2)}</p>{quote.discountCents>0&&<p>Discount −${(quote.discountCents/100).toFixed(2)}</p>}<p>Fees ${(quote.feesCents/100).toFixed(2)} · Tax ${(quote.taxCents/100).toFixed(2)}</p><strong>Total ${(quote.totalCents/100).toFixed(2)}</strong>
      <label className="field"><span>Cash cents</span><input type="number" min="0" value={cashCents} onChange={(event) => setCashCents(event.target.value)} /></label>
      <label className="field"><span>Cash received cents</span><input type="number" min="0" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} /></label>
      <label className="field"><span>Card cents</span><input type="number" min="0" value={cardCents} onChange={(event) => setCardCents(event.target.value)} /></label>
      <label className="field"><span>Terminal reader</span><input value={readerId} onChange={(event) => setReaderId(event.target.value)} /></label>
      <button className="primary" type="button" onClick={checkout} disabled={busy || (Number(cashCents)>0&&!drawer)}>Complete sale</button></div>}
  </aside></section>;
}
