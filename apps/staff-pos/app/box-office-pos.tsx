"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardCents, setGiftCardCents] = useState("0");
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftRemainderTender, setGiftRemainderTender] = useState<"CASH" | "CARD">("CASH");
  const [cashReceived, setCashReceived] = useState("0");
  const [readerId, setReaderId] = useState("tmr_box_1");
  const [message, setMessage] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const checkoutAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const checkoutConfigRequestRef = useRef(0);
  const drawerRequestRef = useRef(0);
  const pricingRequestRef = useRef(0);
  const giftCardRequestRef = useRef(0);
  const saleActionRequestRef = useRef(0);
  const busyRequestRef = useRef(0);
  const activeHoldsRef = useRef<{ showtimeId: string; tokens: string[] } | null>(null);

  useEffect(() => {
    const requestId = ++checkoutConfigRequestRef.current;
    pricingRequestRef.current += 1;
    giftCardRequestRef.current += 1;
    saleActionRequestRef.current += 1;
    busyRequestRef.current += 1;
    busyRef.current = false;
    checkoutAttemptRef.current = null;
    setBusy(false);
    setSelected([]); setQuote(null); setHoldTokens([]); setTicketTypes([]); setTicketTypeId("");
    setPromotionCode(""); setCashCents("0"); setCardCents("0"); setCashReceived("0");
    setGiftCardCode(""); setGiftCardCents("0"); setGiftCardBalance(null); setGiftRemainderTender("CASH");
    setMessage(null);
    apiFetch<{ticketTypes:Array<{id:string;name:string}>}>(`/ticketing/showtimes/${showtimeId}/checkout-config`)
      .then((data) => {
        if (requestId !== checkoutConfigRequestRef.current) return;
        setTicketTypes(data.ticketTypes);
        setTicketTypeId(data.ticketTypes[0]?.id ?? "");
      })
      .catch(() => {
        if (requestId === checkoutConfigRequestRef.current) setMessage("Ticket types are unavailable.");
      });
    return () => {
      checkoutConfigRequestRef.current += 1;
      const activeHolds = activeHoldsRef.current;
      activeHoldsRef.current = null;
      if (activeHolds?.tokens.length) {
        void Promise.allSettled(activeHolds.tokens.map((holdToken) =>
          apiFetch(`/cinema/showtimes/${activeHolds.showtimeId}/holds/${encodeURIComponent(holdToken)}`, {
            method: "DELETE",
            accessToken,
            body: JSON.stringify({ holderKey }),
          }),
        ));
      }
    };
  }, [accessToken, holderKey, showtimeId]);
  useEffect(() => {
    const requestId = ++drawerRequestRef.current;
    setDrawer(null);
    apiFetch<{id:string}|null>(`/box-office/cash-drawers/active?registerId=${encodeURIComponent(registerId)}`, { accessToken })
      .then((activeDrawer) => {
        if (requestId === drawerRequestRef.current) setDrawer(activeDrawer);
      })
      .catch(() => {
        if (requestId === drawerRequestRef.current) setDrawer(null);
      });
    return () => { drawerRequestRef.current += 1; };
  }, [accessToken, registerId]);
  useEffect(() => {
    if (busyRef.current || quote) return;
    const availableSeatIds = new Set(
      seats.filter((seat) => seat.state === "AVAILABLE").map((seat) => seat.id),
    );
    setSelected((current) => {
      const next = current.filter((seatId) => availableSeatIds.has(seatId));
      if (next.length !== current.length) {
        setMessage("Some selected seats are no longer available and were removed.");
      }
      return next.length === current.length ? current : next;
    });
  }, [quote, seats]);

  const mapSeats = useMemo(() => seats.map((seat) => ({ ...seat, state: selected.includes(seat.id) ? "selected" as const : seat.state === "AVAILABLE" ? "available" as const : "unavailable" as const })), [seats, selected]);
  function errorMessage(error: unknown) { return error instanceof ApiRequestError ? error.body.message : "The request could not be completed."; }
  function beginRequest() {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    return ++busyRequestRef.current;
  }
  function finishRequest(requestId: number) {
    if (requestId !== busyRequestRef.current) return;
    busyRef.current = false;
    setBusy(false);
  }
  function resetSale() {
    checkoutAttemptRef.current = null;
    activeHoldsRef.current = null;
    giftCardRequestRef.current += 1;
    setSelected([]);
    setQuote(null);
    setHoldTokens([]);
    setCashCents("0");
    setCardCents("0");
    setCashReceived("0");
    setGiftCardCode("");
    setGiftCardCents("0");
    setGiftCardBalance(null);
  }
  function toggleSeat(seat: SeatMapSeat) {
    if (busyRef.current || quote || !seat.id) return;
    const live = seats.find((candidate) => candidate.id === seat.id);
    if (live?.state !== "AVAILABLE") return;
    setSelected((current) => {
      if (current.includes(seat.id!)) return current.filter((id) => id !== seat.id);
      if (current.length >= 10) {
        setMessage("A Box Office sale can include at most 10 seats.");
        return current;
      }
      setMessage(null);
      return [...current, seat.id!];
    });
  }

  async function openDrawer() {
    const requestedRegisterId = registerId.trim();
    const openingBalanceCents = Number(openingBalance);
    if (!requestedRegisterId) {
      setMessage("Enter a register ID before opening a cash drawer.");
      return;
    }
    if (!Number.isInteger(openingBalanceCents) || openingBalanceCents < 0) {
      setMessage("Opening cash must be a whole, non-negative number of cents.");
      return;
    }
    if (openingBalanceCents > 10_000_000) {
      setMessage("Opening cash cannot exceed 10,000,000 cents.");
      return;
    }
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const requestId = ++drawerRequestRef.current;
    try {
      const openedDrawer = await apiFetch<{id:string}>("/box-office/cash-drawers", { method: "POST", accessToken, body: JSON.stringify({ registerId: requestedRegisterId, openingBalanceCents }) });
      if (requestId === drawerRequestRef.current) setDrawer(openedDrawer);
    } catch (error) {
      if (requestId === drawerRequestRef.current) setMessage(errorMessage(error));
    } finally {
      finishRequest(busyRequestId);
    }
  }

  async function prepareSale(event: FormEvent) {
    event.preventDefault();
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const requestId = ++pricingRequestRef.current;
    const requestShowtimeId = showtimeId;
    let createdHoldTokens: string[] = [];
    async function releaseStaleHolds(tokens: string[]) {
      await Promise.allSettled(tokens.map((holdToken) =>
        apiFetch(`/cinema/showtimes/${requestShowtimeId}/holds/${encodeURIComponent(holdToken)}`, {
          method: "DELETE",
          accessToken,
          body: JSON.stringify({ holderKey }),
        }),
      ));
    }
    try {
      const holds = await apiFetch<Array<{holdToken:string}>>(`/box-office/showtimes/${requestShowtimeId}/holds`, { method: "POST", accessToken, body: JSON.stringify({ seatIds: selected, holderKey }) });
      const tokens = holds.map((hold) => hold.holdToken);
      createdHoldTokens = tokens;
      if (requestId !== pricingRequestRef.current) { await releaseStaleHolds(tokens); return; }
      setHoldTokens(tokens);
      const next = await apiFetch<Quote>("/box-office/quotes", { method: "POST", accessToken, body: JSON.stringify({ holdTokens: tokens, holderKey, promotionCode: promotionCode || undefined }) });
      if (requestId !== pricingRequestRef.current) { await releaseStaleHolds(tokens); return; }
      activeHoldsRef.current = { showtimeId: requestShowtimeId, tokens };
      checkoutAttemptRef.current = null; setQuote(next); setCardCents(String(next.totalCents)); setCashCents("0"); setGiftCardCode(""); setGiftCardCents("0"); setGiftCardBalance(null);
    } catch (error) {
      if (createdHoldTokens.length) {
        await releaseStaleHolds(createdHoldTokens);
        if (requestId === pricingRequestRef.current) setHoldTokens([]);
      }
      if (requestId === pricingRequestRef.current) setMessage(errorMessage(error));
    } finally { finishRequest(busyRequestId); }
  }

  async function checkout() {
    if (!quote) return;
    const parsedCashCents = Number(cashCents || 0);
    const parsedCardCents = Number(cardCents || 0);
    const parsedGiftCardCents = Number(giftCardCents || 0);
    const parsedCashReceived = Number(cashReceived || 0);
    if (
      !Number.isInteger(parsedCashCents) ||
      !Number.isInteger(parsedCardCents) ||
      !Number.isInteger(parsedGiftCardCents) ||
      !Number.isInteger(parsedCashReceived) ||
      parsedCashCents < 0 ||
      parsedCardCents < 0 ||
      parsedGiftCardCents < 0 ||
      parsedCashReceived < 0
    ) {
      setMessage("Tender and cash-received amounts must be whole, non-negative cents.");
      return;
    }
    if (
      parsedCashCents > 10_000_000 ||
      parsedCardCents > 10_000_000 ||
      parsedGiftCardCents > 10_000_000
    ) {
      setMessage("A single tender cannot exceed 10,000,000 cents.");
      return;
    }
    if (parsedCashReceived > 10_000_000) {
      setMessage("Cash received cannot exceed 10,000,000 cents.");
      return;
    }
    if (parsedCashCents + parsedCardCents + parsedGiftCardCents !== quote.totalCents) {
      setMessage(`Tender amounts must total ${quote.totalCents} cents.`);
      return;
    }
    if (parsedCashCents > 0 && !drawer) {
      setMessage("Open a cash drawer before accepting cash.");
      return;
    }
    if (parsedCashCents > 0 && parsedCashReceived < parsedCashCents) {
      setMessage("Cash received must cover the cash tender.");
      return;
    }
    if (parsedCardCents > 0 && !readerId.trim()) {
      setMessage("Choose a Terminal reader for the card tender.");
      return;
    }
    if (parsedGiftCardCents > 0) {
      if (!giftCardCode.trim() || giftCardBalance === null) {
        setMessage("Check the gift card balance before applying it.");
        return;
      }
      if (parsedGiftCardCents > giftCardBalance) {
        setMessage("Gift card tender exceeds the verified balance.");
        return;
      }
      if (parsedCashCents > 0 && parsedCardCents > 0) {
        setMessage("Use a gift card with either cash or card, not all three tenders.");
        return;
      }
    }
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const actionRequestId = ++saleActionRequestRef.current;
    const checkoutPayload = {
      holdTokens,
      holderKey,
      ticketTypeId,
      promotionCode: promotionCode || undefined,
      cashDrawerId: parsedCashCents > 0 ? drawer?.id : undefined,
      cashCents: parsedCashCents,
      cardCents: parsedCardCents,
      giftCardCents: parsedGiftCardCents,
      giftCardCode: parsedGiftCardCents > 0 ? giftCardCode.trim() : undefined,
      readerId: parsedCardCents > 0 ? readerId.trim() : undefined,
      cashReceivedCents: parsedCashCents > 0 ? parsedCashReceived : undefined,
    };
    const fingerprint = JSON.stringify(checkoutPayload);
    if (checkoutAttemptRef.current?.fingerprint !== fingerprint) {
      checkoutAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const order = await apiFetch<{orderNumber:string;tickets:Array<unknown>}>("/box-office/checkouts", { method: "POST", accessToken, body: JSON.stringify({ ...checkoutPayload, requestId: checkoutAttemptRef.current.requestId }) });
      if (actionRequestId !== saleActionRequestRef.current) return;
      setMessage(`Sale complete: ${order.orderNumber} · ${order.tickets.length} ticket(s)`); resetSale(); await refresh();
    } catch (error) {
      if (actionRequestId === saleActionRequestRef.current) setMessage(errorMessage(error));
    } finally {
      if (actionRequestId === saleActionRequestRef.current) finishRequest(busyRequestId);
    }
  }

  async function cancelSale() {
    if (!quote) return;
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const actionRequestId = ++saleActionRequestRef.current;
    const requestShowtimeId = showtimeId;
    try {
      const releases = await Promise.allSettled(
        holdTokens.map((holdToken) =>
          apiFetch(`/cinema/showtimes/${requestShowtimeId}/holds/${encodeURIComponent(holdToken)}`, {
            method: "DELETE",
            accessToken,
            body: JSON.stringify({ holderKey }),
          }),
        ),
      );
      if (actionRequestId !== saleActionRequestRef.current) return;
      const failedReleases = releases.filter((release) => release.status === "rejected").length;
      resetSale();
      await refresh();
      setMessage(
        failedReleases
          ? `Sale canceled. ${failedReleases} seat hold(s) may remain until they expire.`
          : "Sale canceled and seat holds released.",
      );
    } catch (error) {
      if (actionRequestId === saleActionRequestRef.current) setMessage(errorMessage(error));
    } finally {
      if (actionRequestId === saleActionRequestRef.current) finishRequest(busyRequestId);
    }
  }

  async function checkGiftCard() {
    if (!quote || !giftCardCode) return;
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const requestId = ++giftCardRequestRef.current;
    const requestedCode = giftCardCode.trim();
    const requestedTotalCents = quote.totalCents;
    try {
      const card = await apiFetch<{balanceCents:number;currency:string}>("/box-office/gift-cards/balance", { method: "POST", accessToken, body: JSON.stringify({ code: requestedCode }) });
      if (requestId !== giftCardRequestRef.current) return;
      const applied = Math.min(card.balanceCents, requestedTotalCents);
      const remainder = requestedTotalCents - applied;
      setGiftCardBalance(card.balanceCents); setGiftCardCents(String(applied)); setCashCents(giftRemainderTender === "CASH" ? String(remainder) : "0"); setCardCents(giftRemainderTender === "CARD" ? String(remainder) : "0");
    } catch (error) {
      if (requestId === giftCardRequestRef.current) { setGiftCardBalance(null); setGiftCardCents("0"); setMessage(errorMessage(error)); }
    } finally { finishRequest(busyRequestId); }
  }

  return <section className="box-office-grid"><div>
    <h2>Box office</h2><p>Select available seats from the live inventory.</p>
    <SeatMap seats={mapSeats} label="Box office seat map" onSeatClick={toggleSeat} allowUnavailableSelection />
  </div><aside className="checkout-card">
    {message && <div className={message.startsWith("Sale complete") || message.startsWith("Sale canceled and") ? "scan-result valid" : "error-banner"}>{message}</div>}
    <h3>Register</h3><label className="field"><span>Register ID</span><input value={registerId} disabled={busy || Boolean(quote)} onChange={(event) => setRegisterId(event.target.value)} /></label>
    {!drawer && <><label className="field"><span>Opening cash (cents)</span><input type="number" min="0" value={openingBalance} disabled={busy || Boolean(quote)} onChange={(event) => setOpeningBalance(event.target.value)} /></label><button className="primary" type="button" onClick={openDrawer} disabled={busy || Boolean(quote)}>Open drawer</button></>}
    {drawer && <p className="success-copy">Cash drawer open</p>}
    <form onSubmit={prepareSale}><label className="field"><span>Ticket type</span><select value={ticketTypeId} disabled={busy || Boolean(quote)} onChange={(event) => setTicketTypeId(event.target.value)}>{ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label className="field"><span>Promotion code</span><input value={promotionCode} disabled={busy || Boolean(quote)} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} /></label>
      <button className="primary" disabled={!selected.length || !ticketTypeId || busy || Boolean(quote)}>Price {selected.length} seat(s)</button></form>
    {quote && <div className="sale-total"><p>Pricing locked for the held seats.</p><p>Subtotal ${(quote.subtotalCents/100).toFixed(2)}</p>{quote.discountCents>0&&<p>Discount −${(quote.discountCents/100).toFixed(2)}</p>}<p>Fees ${(quote.feesCents/100).toFixed(2)} · Tax ${(quote.taxCents/100).toFixed(2)}</p><strong>Total ${(quote.totalCents/100).toFixed(2)}</strong>
      <label className="field"><span>Cash cents</span><input type="number" min="0" step="1" value={cashCents} disabled={busy} onChange={(event) => setCashCents(event.target.value)} /></label>
      <label className="field"><span>Cash received cents</span><input type="number" min="0" step="1" value={cashReceived} disabled={busy} onChange={(event) => setCashReceived(event.target.value)} /></label>
      <label className="field"><span>Card cents</span><input type="number" min="0" step="1" value={cardCents} disabled={busy} onChange={(event) => setCardCents(event.target.value)} /></label>
      <label className="field"><span>Terminal reader</span><input value={readerId} disabled={busy} onChange={(event) => setReaderId(event.target.value)} /></label>
      <label className="field"><span>Gift card code</span><input value={giftCardCode} disabled={busy} onChange={(event) => { giftCardRequestRef.current += 1; setGiftCardCode(event.target.value.toUpperCase()); setGiftCardBalance(null); setGiftCardCents("0"); setCashCents("0"); setCardCents(String(quote.totalCents)); }} /></label>
      {giftCardCode && <><button className="secondary" type="button" onClick={() => void checkGiftCard()} disabled={busy}>Check balance and apply</button>{giftCardBalance !== null && <p>Available ${(giftCardBalance/100).toFixed(2)}</p>}<label className="field"><span>Gift card cents</span><input type="number" min="1" step="1" max={Math.min(quote.totalCents, giftCardBalance ?? quote.totalCents)} value={giftCardCents} disabled={busy} onChange={(event) => { const giftCents = Number(event.target.value); const remainder = Math.max(0, quote.totalCents - giftCents); setGiftCardCents(event.target.value); setCashCents(giftRemainderTender === "CASH" ? String(remainder) : "0"); setCardCents(giftRemainderTender === "CARD" ? String(remainder) : "0"); }} /></label><label className="field"><span>Remainder tender</span><select value={giftRemainderTender} disabled={busy} onChange={(event) => { const tender = event.target.value as "CASH" | "CARD"; const remainder = Math.max(0, quote.totalCents - Number(giftCardCents)); setGiftRemainderTender(tender); setCashCents(tender === "CASH" ? String(remainder) : "0"); setCardCents(tender === "CARD" ? String(remainder) : "0"); }}><option value="CASH">Cash</option><option value="CARD">Card terminal</option></select></label></>}
      <button className="primary" type="button" onClick={checkout} disabled={busy || (Number(cashCents)>0&&!drawer)}>Complete sale</button></div>}
      {quote && <button className="secondary" type="button" onClick={cancelSale} disabled={busy}>Cancel sale &amp; release seats</button>}
  </aside></section>;
}
