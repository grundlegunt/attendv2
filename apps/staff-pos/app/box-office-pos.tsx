"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SeatMap, type SeatMapSeat, type SeatMapSeatingStyle } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type LiveSeat = Omit<SeatMapSeat, "state"> & { id: string; state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" };
type Quote = { subtotalCents: number; discountCents: number; feesCents: number; taxCents: number; totalCents: number; currency: string; seats: Array<{label:string}>; ticketType: {id:string;name:string;priceCents:number}; tickets: Array<{holdToken:string;seatLabel:string;ticketTypeId:string;ticketTypeName:string;priceCents:number}>; promotion: {code:string;name:string}|null };
type CustomerResult = { id: string; name: string | null; email: string | null; phone: string | null; membership: { membershipNumber: string; tier: string; status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELED"; expiresAt: string | null } | null };
const DEFAULT_READER_ID = "tmr_box_1";

export function BoxOfficePos({ accessToken, showtimeId, seats, seatingMode, seatingStyle, refresh }: { accessToken: string; showtimeId: string; seats: LiveSeat[]; seatingMode: "RESERVED" | "GENERAL_ADMISSION"; seatingStyle: SeatMapSeatingStyle; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [holderKey] = useState(() => `box-office-${crypto.randomUUID()}`);
  const [ticketTypes, setTicketTypes] = useState<Array<{id:string;name:string;priceAdjustmentMinor:number}>>([]);
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [ticketTypeBySeatId, setTicketTypeBySeatId] = useState<Record<string, string>>({});
  const [promotionCode, setPromotionCode] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [holdTokens, setHoldTokens] = useState<string[]>([]);
  const [registerId, setRegisterId] = useState("BOX-1");
  const [drawer, setDrawer] = useState<{id:string}|null>(null);
  const [drawerStatus, setDrawerStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openingBalance, setOpeningBalance] = useState("20000");
  const [cashCents, setCashCents] = useState("0");
  const [cardCents, setCardCents] = useState("0");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardCents, setGiftCardCents] = useState("0");
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardCurrency, setGiftCardCurrency] = useState<string | null>(null);
  const [giftRemainderTender, setGiftRemainderTender] = useState<"CASH" | "CARD">("CASH");
  const [cashReceived, setCashReceived] = useState("0");
  const [readerId, setReaderId] = useState(DEFAULT_READER_ID);
  const [message, setMessage] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const checkoutAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const openDrawerAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const checkoutConfigRequestRef = useRef(0);
  const drawerRequestRef = useRef(0);
  const pricingRequestRef = useRef(0);
  const giftCardRequestRef = useRef(0);
  const customerSearchRequestRef = useRef(0);
  const customerSearchPendingRef = useRef(false);
  const saleActionRequestRef = useRef(0);
  const busyRequestRef = useRef(0);
  const activeHoldsRef = useRef<{ showtimeId: string; tokens: string[] } | null>(null);
  const isGeneralAdmission = seatingMode === "GENERAL_ADMISSION";
  const availableSeats = useMemo(() => seats.filter((seat) => seat.state === "AVAILABLE"), [seats]);

  useEffect(() => {
    const requestId = ++checkoutConfigRequestRef.current;
    pricingRequestRef.current += 1;
    giftCardRequestRef.current += 1;
    customerSearchRequestRef.current += 1;
    customerSearchPendingRef.current = false;
    saleActionRequestRef.current += 1;
    busyRequestRef.current += 1;
    busyRef.current = false;
    checkoutAttemptRef.current = null;
    setBusy(false);
    setSelected([]); setQuote(null); setHoldTokens([]); setTicketTypes([]); setTicketTypeId(""); setTicketTypeBySeatId({});
    setPromotionCode(""); setCustomerQuery(""); setCustomerResults([]); setCustomerName(""); setCustomerEmail(""); setSelectedCustomerId(null); setCustomerSearching(false); setCashCents("0"); setCardCents("0"); setCashReceived("0");
    setGiftCardCode(""); setGiftCardCents("0"); setGiftCardBalance(null); setGiftCardCurrency(null); setGiftRemainderTender("CASH");
    setReaderId(DEFAULT_READER_ID);
    setMessage(null);
    apiFetch<{currency:string;ticketTypes:Array<{id:string;name:string;priceAdjustmentMinor:number}>}>(`/ticketing/showtimes/${showtimeId}/checkout-config`)
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
    const requestedRegisterId = registerId.trim();
    if (!requestedRegisterId || requestedRegisterId.length > 100) {
      setDrawerStatus("error");
      return () => { drawerRequestRef.current += 1; };
    }
    setDrawerStatus("loading");
    apiFetch<{id:string}|null>(`/box-office/cash-drawers/active?registerId=${encodeURIComponent(requestedRegisterId)}`, { accessToken })
      .then((activeDrawer) => {
        if (requestId !== drawerRequestRef.current) return;
        setDrawer(activeDrawer);
        setDrawerStatus("ready");
      })
      .catch(() => {
        if (requestId !== drawerRequestRef.current) return;
        setDrawer(null);
        setDrawerStatus("error");
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
        setMessage(`Some selected ${isGeneralAdmission ? "tickets are" : "seats are"} no longer available and were removed.`);
      }
      return next.length === current.length ? current : next;
    });
  }, [isGeneralAdmission, quote, seats]);

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
    customerSearchRequestRef.current += 1;
    setSelected([]);
    setTicketTypeBySeatId({});
    setQuote(null);
    setHoldTokens([]);
    setPromotionCode("");
    setCustomerQuery("");
    setCustomerResults([]);
    setCustomerName("");
    setCustomerEmail("");
    setSelectedCustomerId(null);
    setCustomerSearching(false);
    setCashCents("0");
    setCardCents("0");
    setCashReceived("0");
    setGiftCardCode("");
    setGiftCardCents("0");
    setGiftCardBalance(null);
    setGiftCardCurrency(null);
    setGiftRemainderTender("CASH");
    setReaderId(DEFAULT_READER_ID);
  }
  function changeRegister(nextRegisterId: string) {
    openDrawerAttemptRef.current = null;
    drawerRequestRef.current += 1;
    setDrawer(null);
    setDrawerStatus("loading");
    setOpeningBalance("");
    setReaderId(DEFAULT_READER_ID);
    setMessage(null);
    setRegisterId(nextRegisterId);
  }
  function toggleSeat(seat: SeatMapSeat) {
    if (busyRef.current || quote || !seat.id) return;
    const live = seats.find((candidate) => candidate.id === seat.id);
    if (live?.state !== "AVAILABLE") return;
    setSelected((current) => {
      if (current.includes(seat.id!)) {
        setTicketTypeBySeatId((types) => { const next = { ...types }; delete next[seat.id!]; return next; });
        return current.filter((id) => id !== seat.id);
      }
      if (current.length >= 10) {
        setMessage("A Box Office sale can include at most 10 seats.");
        return current;
      }
      setMessage(null);
      setTicketTypeBySeatId((types) => ({ ...types, [seat.id!]: ticketTypeId }));
      return [...current, seat.id!];
    });
  }

  function changeGeneralAdmissionQuantity(nextQuantity: number) {
    if (busyRef.current || quote) return;
    const quantity = Math.max(0, Math.min(10, availableSeats.length, nextQuantity));
    setSelected(availableSeats.slice(0, quantity).map((seat) => seat.id));
    setTicketTypeBySeatId(Object.fromEntries(availableSeats.slice(0, quantity).map((seat) => [seat.id, ticketTypeBySeatId[seat.id] ?? ticketTypeId])));
    setMessage(null);
  }

  async function openDrawer() {
    const requestedRegisterId = registerId.trim();
    const openingBalanceCents = Number(openingBalance);
    if (!requestedRegisterId) {
      setMessage("Enter a register ID before opening a cash drawer.");
      return;
    }
    if (requestedRegisterId.length > 100) {
      setMessage("Register IDs cannot exceed 100 characters.");
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
    const fingerprint = `${requestedRegisterId}:${openingBalanceCents}`;
    if (openDrawerAttemptRef.current?.fingerprint !== fingerprint) {
      openDrawerAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const openedDrawer = await apiFetch<{id:string}>("/box-office/cash-drawers", { method: "POST", accessToken, body: JSON.stringify({ requestId: openDrawerAttemptRef.current.requestId, registerId: requestedRegisterId, openingBalanceCents }) });
      if (requestId === drawerRequestRef.current) { openDrawerAttemptRef.current = null; setDrawer(openedDrawer); setDrawerStatus("ready"); }
    } catch (error) {
      if (requestId === drawerRequestRef.current) setMessage(errorMessage(error));
    } finally {
      finishRequest(busyRequestId);
    }
  }

  async function prepareSale(event: FormEvent) {
    event.preventDefault();
    const requestedPromotionCode = promotionCode.trim();
    if (requestedPromotionCode.length > 50) {
      setMessage("Promotion codes cannot exceed 50 characters.");
      return;
    }
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
      const holds = await apiFetch<Array<{holdToken:string;seatId:string}>>(`/box-office/showtimes/${requestShowtimeId}/holds`, { method: "POST", accessToken, body: JSON.stringify({ seatIds: selected, holderKey }) });
      const tokens = holds.map((hold) => hold.holdToken);
      createdHoldTokens = tokens;
      if (requestId !== pricingRequestRef.current) { await releaseStaleHolds(tokens); return; }
      setHoldTokens(tokens);
      const ticketTypeSelections = holds.map((hold) => ({ holdToken: hold.holdToken, ticketTypeId: ticketTypeBySeatId[hold.seatId] ?? ticketTypeId }));
      const next = await apiFetch<Quote>("/box-office/quotes", { method: "POST", accessToken, body: JSON.stringify({ holdTokens: tokens, holderKey, ticketTypeId, ticketTypeSelections, promotionCode: requestedPromotionCode || undefined }) });
      if (requestId !== pricingRequestRef.current) { await releaseStaleHolds(tokens); return; }
      activeHoldsRef.current = { showtimeId: requestShowtimeId, tokens };
      checkoutAttemptRef.current = null; setQuote(next); setCardCents(String(next.totalCents)); setCashCents("0"); setCashReceived("0"); setGiftCardCode(""); setGiftCardCents("0"); setGiftCardBalance(null); setGiftCardCurrency(null); setGiftRemainderTender("CASH");
    } catch (error) {
      if (createdHoldTokens.length) {
        await releaseStaleHolds(createdHoldTokens);
        if (requestId === pricingRequestRef.current) setHoldTokens([]);
      }
      if (requestId === pricingRequestRef.current) setMessage(errorMessage(error));
    } finally { finishRequest(busyRequestId); }
  }

  async function searchCustomers() {
    const query = customerQuery.trim();
    if (query.length < 2 || query.length > 100) { setMessage("Enter 2 to 100 characters to find a customer."); return; }
    if (busyRef.current || customerSearchPendingRef.current) return;
    customerSearchPendingRef.current = true;
    const requestId = ++customerSearchRequestRef.current;
    setCustomerSearching(true);
    setMessage(null);
    try {
      const results = await apiFetch<CustomerResult[]>(`/box-office/customers?q=${encodeURIComponent(query)}`, { accessToken });
      if (requestId !== customerSearchRequestRef.current) return;
      setCustomerResults(results);
      if (!results.length) setMessage("No matching ticket customers were found. You can enter new customer details below.");
    } catch (error) { if (requestId === customerSearchRequestRef.current) { setMessage(errorMessage(error)); setCustomerResults([]); } } finally { if (requestId === customerSearchRequestRef.current) { customerSearchPendingRef.current = false; setCustomerSearching(false); } }
  }

  async function checkout() {
    if (!quote) return;
    const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
    const normalizedCustomerName = customerName.trim();
    if (normalizedCustomerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCustomerEmail)) { setMessage("Enter a valid customer email or leave it blank for a walk-up sale."); return; }
    const parsedCashCents = Number(cashCents || 0);
    const parsedCardCents = Number(cardCents || 0);
    const parsedGiftCardCents = Number(giftCardCents || 0);
    const parsedCashReceived = Number(cashReceived || 0);
    if (
      !Number.isInteger(parsedCashCents) ||
      !Number.isInteger(parsedCardCents) ||
      !Number.isInteger(parsedGiftCardCents) ||
      parsedCashCents < 0 ||
      parsedCardCents < 0 ||
      parsedGiftCardCents < 0
    ) {
      setMessage("Tender amounts must be whole, non-negative cents.");
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
    if (parsedCashCents > 0 && (!Number.isInteger(parsedCashReceived) || parsedCashReceived < 0)) {
      setMessage("Cash received must be a whole, non-negative number of cents.");
      return;
    }
    if (parsedCashCents > 0 && parsedCashReceived > 10_000_000) {
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
    if (parsedCardCents > 0 && readerId.trim().length > 200) {
      setMessage("Terminal reader IDs cannot exceed 200 characters.");
      return;
    }
    if (parsedGiftCardCents > 0) {
      const requestedGiftCardCode = giftCardCode.trim();
      if (requestedGiftCardCode.length < 20 || requestedGiftCardCode.length > 40) {
        setMessage("Gift card codes must contain 20 to 40 characters.");
        return;
      }
      if (giftCardBalance === null) {
        setMessage("Check the gift card balance before applying it.");
        return;
      }
      if (giftCardCurrency !== quote.currency) {
        setMessage(`Gift card currency ${giftCardCurrency ?? "unknown"} does not match ${quote.currency}.`);
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
      ticketTypeSelections: quote.tickets.map(({ holdToken, ticketTypeId }) => ({ holdToken, ticketTypeId })),
      promotionCode: promotionCode.trim() || undefined,
      cashDrawerId: parsedCashCents > 0 ? drawer?.id : undefined,
      cashCents: parsedCashCents,
      cardCents: parsedCardCents,
      giftCardCents: parsedGiftCardCents,
      giftCardCode: parsedGiftCardCents > 0 ? giftCardCode.trim() : undefined,
      readerId: parsedCardCents > 0 ? readerId.trim() : undefined,
      cashReceivedCents: parsedCashCents > 0 ? parsedCashReceived : undefined,
      customerId: selectedCustomerId ?? undefined,
      customerEmail: normalizedCustomerEmail || undefined,
      customerName: normalizedCustomerName || undefined,
    };
    const fingerprint = JSON.stringify(checkoutPayload);
    if (checkoutAttemptRef.current?.fingerprint !== fingerprint) {
      checkoutAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      const order = await apiFetch<{orderNumber:string;tickets:Array<unknown>;receiptDelivery:"SENT"|"FAILED"|"NOT_REQUESTED"}>("/box-office/checkouts", { method: "POST", accessToken, body: JSON.stringify({ ...checkoutPayload, requestId: checkoutAttemptRef.current.requestId }) });
      if (actionRequestId !== saleActionRequestRef.current) return;
      const receiptStatus = order.receiptDelivery === "SENT" ? " · receipt emailed" : order.receiptDelivery === "FAILED" ? " · receipt email failed; reprint tickets if needed" : "";
      setMessage(`Sale complete: ${order.orderNumber} · ${order.tickets.length} ticket(s)${receiptStatus}`); resetSale(); await refresh();
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
          ? `Sale canceled. ${failedReleases} ${isGeneralAdmission ? "ticket" : "seat"} hold(s) may remain until they expire.`
          : `Sale canceled and ${isGeneralAdmission ? "ticket" : "seat"} holds released.`,
      );
    } catch (error) {
      if (actionRequestId === saleActionRequestRef.current) setMessage(errorMessage(error));
    } finally {
      if (actionRequestId === saleActionRequestRef.current) finishRequest(busyRequestId);
    }
  }

  async function checkGiftCard() {
    if (!quote || !giftCardCode) return;
    const requestedCode = giftCardCode.trim();
    if (requestedCode.length < 20 || requestedCode.length > 40) {
      setMessage("Gift card codes must contain 20 to 40 characters.");
      return;
    }
    const busyRequestId = beginRequest();
    if (busyRequestId === null) return;
    const requestId = ++giftCardRequestRef.current;
    const requestedTotalCents = quote.totalCents;
    try {
      const card = await apiFetch<{balanceCents:number;currency:string}>("/box-office/gift-cards/balance", { method: "POST", accessToken, body: JSON.stringify({ code: requestedCode }) });
      if (requestId !== giftCardRequestRef.current) return;
      if (card.currency !== quote.currency) {
        setGiftCardBalance(null); setGiftCardCurrency(null); setGiftCardCents("0");
        setMessage(`Gift card currency ${card.currency} does not match ${quote.currency}.`);
        return;
      }
      const applied = Math.min(card.balanceCents, requestedTotalCents);
      const remainder = requestedTotalCents - applied;
      setGiftCardBalance(card.balanceCents); setGiftCardCurrency(card.currency); setGiftCardCents(String(applied)); setCashCents(giftRemainderTender === "CASH" ? String(remainder) : "0"); setCashReceived("0"); setCardCents(giftRemainderTender === "CARD" ? String(remainder) : "0");
    } catch (error) {
      if (requestId === giftCardRequestRef.current) { setGiftCardBalance(null); setGiftCardCurrency(null); setGiftCardCents("0"); setMessage(errorMessage(error)); }
    } finally { finishRequest(busyRequestId); }
  }

  return <section className="box-office-grid"><div>
    <h2>Box office</h2><p>{isGeneralAdmission ? "Choose a ticket quantity from the live general admission inventory." : "Select available seats from the live inventory."}</p>
    {isGeneralAdmission ? <div className="ga-pos-picker" aria-label="General admission ticket quantity">
      <span className="eyebrow">GENERAL ADMISSION</span>
      <strong>{availableSeats.length} tickets available</strong>
      <div className="ga-quantity-control">
        <button type="button" className="secondary" aria-label="Remove one ticket" disabled={busy || Boolean(quote) || selected.length === 0} onClick={() => changeGeneralAdmissionQuantity(selected.length - 1)}>−</button>
        <output aria-live="polite">{selected.length}</output>
        <button type="button" className="secondary" aria-label="Add one ticket" disabled={busy || Boolean(quote) || selected.length >= Math.min(10, availableSeats.length)} onClick={() => changeGeneralAdmissionQuantity(selected.length + 1)}>+</button>
      </div>
      <span>Maximum 10 tickets per sale</span>
    </div> : <SeatMap seats={mapSeats} seatingStyle={seatingStyle} label="Box office seat map" onSeatClick={toggleSeat} allowUnavailableSelection />}
  </div><aside className="checkout-card">
    {message && <div className={message.startsWith("Sale complete") || message.startsWith("Sale canceled and") ? "scan-result valid" : "error-banner"}>{message}</div>}
    <h3>Register</h3><label className="field"><span>Register ID</span><input value={registerId} maxLength={100} disabled={busy || Boolean(quote)} onChange={(event) => changeRegister(event.target.value)} /></label>
    {drawerStatus === "error" && <div className="error-banner">Cash drawer status is unavailable. Check the register ID or try again before opening a drawer.</div>}
    {!drawer && <><label className="field"><span>Opening cash (cents)</span><input type="number" min="0" value={openingBalance} disabled={busy || Boolean(quote) || drawerStatus !== "ready"} onChange={(event) => setOpeningBalance(event.target.value)} /></label><button className="primary" type="button" onClick={openDrawer} disabled={busy || Boolean(quote) || drawerStatus !== "ready"}>{drawerStatus === "loading" ? "Checking drawer…" : "Open drawer"}</button></>}
    {drawer && <p className="success-copy">Cash drawer open</p>}
    <form onSubmit={prepareSale}><label className="field"><span>Apply one type to all tickets</span><select value={ticketTypeId} disabled={busy || Boolean(quote)} onChange={(event) => { const nextTypeId = event.target.value; setTicketTypeId(nextTypeId); setTicketTypeBySeatId(Object.fromEntries(selected.map((seatId) => [seatId, nextTypeId]))); }}>{ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}{type.priceAdjustmentMinor ? ` (${type.priceAdjustmentMinor > 0 ? "+" : ""}${(type.priceAdjustmentMinor / 100).toFixed(2)})` : ""}</option>)}</select></label>
      {selected.map((seatId, index) => <label className="field" key={seatId}><span>{isGeneralAdmission ? `Ticket ${index + 1}` : `Seat ${seats.find((seat) => seat.id === seatId)?.label ?? index + 1}`}</span><select value={ticketTypeBySeatId[seatId] ?? ticketTypeId} disabled={busy || Boolean(quote)} onChange={(event) => setTicketTypeBySeatId((current) => ({ ...current, [seatId]: event.target.value }))}>{ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}{type.priceAdjustmentMinor ? ` (${type.priceAdjustmentMinor > 0 ? "+" : ""}${(type.priceAdjustmentMinor / 100).toFixed(2)})` : ""}</option>)}</select></label>)}
      <label className="field"><span>Promotion code</span><input value={promotionCode} maxLength={50} disabled={busy || Boolean(quote)} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} /></label>
      <button className="primary" disabled={!selected.length || !ticketTypeId || busy || Boolean(quote)}>Price {selected.length} {isGeneralAdmission ? "ticket(s)" : "seat(s)"}</button></form>
    {quote && <div className="sale-total"><p>Pricing locked for the held {isGeneralAdmission ? "tickets" : "seats"}.</p>{quote.tickets.map((ticket, index) => <p key={ticket.holdToken}>{isGeneralAdmission ? `Ticket ${index + 1}` : ticket.seatLabel} · {ticket.ticketTypeName} · ${(ticket.priceCents/100).toFixed(2)}</p>)}<p>Subtotal ${(quote.subtotalCents/100).toFixed(2)}</p>{quote.discountCents>0&&<p>Promotion{quote.promotion ? ` · ${quote.promotion.name} (${quote.promotion.code})` : ""} −${(quote.discountCents/100).toFixed(2)}</p>}<p>Fees ${(quote.feesCents/100).toFixed(2)} · Tax ${(quote.taxCents/100).toFixed(2)}</p><strong>Total ${(quote.totalCents/100).toFixed(2)}</strong>
      <section className="customer-attach"><h4>Customer (optional)</h4><p>Attach this sale for lookup and service later, or leave blank for a walk-up customer.</p><div className="customer-attach__search"><label className="field"><span>Find by name, email, phone, or membership number</span><input value={customerQuery} maxLength={100} disabled={busy || customerSearching} onChange={(event) => setCustomerQuery(event.target.value)} /></label><button className="secondary" type="button" disabled={busy || customerSearching || customerQuery.trim().length < 2} onClick={() => void searchCustomers()}>{customerSearching ? "Searching…" : "Find customer"}</button></div>{customerResults.length > 0 && <div className="customer-attach__results">{customerResults.map((customer) => <button className="secondary" type="button" key={customer.id} disabled={busy} onClick={() => { setSelectedCustomerId(customer.id); setCustomerName(customer.name ?? ""); setCustomerEmail(customer.email ?? ""); setCustomerQuery(customer.email ?? customer.phone ?? customer.membership?.membershipNumber ?? ""); setCustomerResults([]); setMessage(null); }}><strong>{customer.name || customer.email || customer.phone}</strong><span>{customer.email || customer.phone}{customer.email && customer.phone ? ` · ${customer.phone}` : ""}</span>{customer.membership && <span>Member · {customer.membership.tier} · {customer.membership.status.toLowerCase()} · #{customer.membership.membershipNumber}</span>}</button>)}</div>}<label className="field"><span>Customer name</span><input value={customerName} maxLength={120} disabled={busy} onChange={(event) => { setSelectedCustomerId(null); setCustomerName(event.target.value); }} /></label><label className="field"><span>Customer email</span><input type="email" value={customerEmail} maxLength={320} disabled={busy} onChange={(event) => { setSelectedCustomerId(null); setCustomerEmail(event.target.value); }} /></label>{(selectedCustomerId || customerName || customerEmail) && <button className="secondary" type="button" disabled={busy} onClick={() => { setSelectedCustomerId(null); setCustomerName(""); setCustomerEmail(""); setCustomerQuery(""); setCustomerResults([]); }}>Clear customer</button>}</section>
      <label className="field"><span>Cash cents</span><input type="number" min="0" step="1" value={cashCents} disabled={busy} onChange={(event) => { setCashCents(event.target.value); setCashReceived("0"); }} /></label>
      <label className="field"><span>Cash received cents</span><input type="number" min="0" step="1" value={cashReceived} disabled={busy || Number(cashCents) <= 0} onChange={(event) => setCashReceived(event.target.value)} /></label>
      <label className="field"><span>Card cents</span><input type="number" min="0" step="1" value={cardCents} disabled={busy} onChange={(event) => setCardCents(event.target.value)} /></label>
      <label className="field"><span>Terminal reader</span><input value={readerId} maxLength={200} disabled={busy || Number(cardCents) <= 0} onChange={(event) => setReaderId(event.target.value)} /></label>
      <label className="field"><span>Gift card code</span><input value={giftCardCode} minLength={20} maxLength={40} disabled={busy} onChange={(event) => { giftCardRequestRef.current += 1; setGiftCardCode(event.target.value.toUpperCase()); setGiftCardBalance(null); setGiftCardCurrency(null); setGiftCardCents("0"); setCashCents("0"); setCashReceived("0"); setCardCents(String(quote.totalCents)); }} /></label>
      {giftCardCode && <><button className="secondary" type="button" onClick={() => void checkGiftCard()} disabled={busy}>Check balance and apply</button>{giftCardBalance !== null && <p>Available {(giftCardBalance/100).toFixed(2)} {giftCardCurrency}</p>}<label className="field"><span>Gift card cents</span><input type="number" min="1" step="1" max={Math.min(quote.totalCents, giftCardBalance ?? quote.totalCents)} value={giftCardCents} disabled={busy} onChange={(event) => { const giftCents = Number(event.target.value); const remainder = Math.max(0, quote.totalCents - giftCents); setGiftCardCents(event.target.value); setCashCents(giftRemainderTender === "CASH" ? String(remainder) : "0"); setCashReceived("0"); setCardCents(giftRemainderTender === "CARD" ? String(remainder) : "0"); }} /></label><label className="field"><span>Remainder tender</span><select value={giftRemainderTender} disabled={busy} onChange={(event) => { const tender = event.target.value as "CASH" | "CARD"; const remainder = Math.max(0, quote.totalCents - Number(giftCardCents)); setGiftRemainderTender(tender); setCashCents(tender === "CASH" ? String(remainder) : "0"); setCashReceived("0"); setCardCents(tender === "CARD" ? String(remainder) : "0"); }}><option value="CASH">Cash</option><option value="CARD">Card terminal</option></select></label></>}
      <button className="primary" type="button" onClick={checkout} disabled={busy || (Number(cashCents)>0&&!drawer)}>Complete sale</button></div>}
      {quote && <button className="secondary" type="button" onClick={cancelSale} disabled={busy}>Cancel sale &amp; release {isGeneralAdmission ? "tickets" : "seats"}</button>}
  </aside></section>;
}
