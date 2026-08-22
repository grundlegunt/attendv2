"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type TicketOrder = {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  guestName: string | null;
  guestEmail: string | null;
  customer: { name: string | null; email: string } | null;
  createdAt: string;
  tickets: Array<{
    id: string;
    status: string;
    priceCentsPaid: number;
    ticketType: { name: string };
    showtimeSeat: {
      seat: { label: string };
      showtime: {
        startsAt: string;
        movie: { title: string };
        auditorium: { name: string };
      };
    };
  }>;
};

type ExchangeSeat = {
  id: string;
  label: string;
  state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";
};

type ExchangeAvailability = {
  showtime: {
    id: string;
    priceTier: { ticketPriceMinor: number; currency: string };
  };
  seats: ExchangeSeat[];
};

type ActiveHold = { showtimeId: string; holdToken: string; holderKey: string };

type PrintableTicket = {
  ticketId: string;
  credential: string;
  orderNumber: string;
  movie: string;
  auditorium: string;
  startsAt: string;
  seat: string;
  ticketType: string;
};

export function TicketService({
  accessToken,
  movies,
  canExchange,
}: {
  accessToken: string;
  movies: NowPlayingMovie[];
  canExchange: boolean;
}) {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [printable, setPrintable] = useState<PrintableTicket | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receiptEmails, setReceiptEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [exchangeTicket, setExchangeTicket] = useState<TicketOrder["tickets"][number] | null>(null);
  const [exchangeShowtimeId, setExchangeShowtimeId] = useState("");
  const [exchangeSeats, setExchangeSeats] = useState<ExchangeSeat[]>([]);
  const [exchangeSeatId, setExchangeSeatId] = useState("");
  const [exchangeReason, setExchangeReason] = useState("");
  const [exchangePriceMatches, setExchangePriceMatches] = useState(true);
  const requestRef = useRef(0);
  const activeHoldRef = useRef<ActiveHold | null>(null);
  const exchangeRequestIdRef = useRef("");
  const exchangeHolderKeyRef = useRef("");
  const receiptAttemptRef = useRef<Record<string, { email: string; requestId: string }>>({});

  async function releaseHold(hold = activeHoldRef.current) {
    if (!hold) return;
    if (activeHoldRef.current?.holdToken === hold.holdToken) activeHoldRef.current = null;
    try {
      await apiFetch(`/cinema/showtimes/${hold.showtimeId}/holds/${hold.holdToken}`, {
        method: "DELETE",
        body: JSON.stringify({ holderKey: hold.holderKey }),
      });
    } catch {
      // Holds expire after five minutes; a failed best-effort release must not hide the exchange UI.
    }
  }

  useEffect(() => () => { void releaseHold(activeHoldRef.current); }, []);

  function errorMessage(error: unknown) {
    return error instanceof ApiRequestError
      ? error.body.message
      : "Ticket service is temporarily unavailable.";
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) {
      setMessage("Enter at least two characters.");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setBusy(true);
    setMessage(null);
    setPrintable(null);
    setExchangeTicket(null);
    void releaseHold();
    try {
      const results = await apiFetch<TicketOrder[]>(
        `/box-office/orders?q=${encodeURIComponent(normalized)}`,
        { accessToken },
      );
      if (requestId !== requestRef.current) return;
      setOrders(results);
      setReceiptEmails(Object.fromEntries(results.map((order) => [order.id, order.guestEmail || order.customer?.email || ""])));
      if (!results.length) setMessage("No ticket orders match this search.");
    } catch (error) {
      if (requestId === requestRef.current) {
        setOrders([]);
        setMessage(errorMessage(error));
      }
    } finally {
      if (requestId === requestRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function resendReceipt(order: TicketOrder) {
    const email = receiptEmails[order.id]?.trim().toLowerCase();
    if (!email) return;
    if (busyRef.current) return;
    busyRef.current = true;
    if (receiptAttemptRef.current[order.id]?.email !== email) {
      receiptAttemptRef.current[order.id] = { email, requestId: crypto.randomUUID() };
    }
    const requestId = receiptAttemptRef.current[order.id]!.requestId;
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ receiptDelivery: "SENT" | "FAILED"; email: string }>(`/box-office/orders/${order.id}/receipt`, {
        accessToken,
        method: "POST",
        body: JSON.stringify({ requestId, email }),
      });
      if (result.receiptDelivery === "SENT") delete receiptAttemptRef.current[order.id];
      setMessage(result.receiptDelivery === "SENT" ? `Receipt sent to ${result.email}.` : `Receipt delivery to ${result.email} failed. Reprint the tickets instead.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function prepareReprint(ticketId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await apiFetch<PrintableTicket>(
        `/box-office/tickets/${ticketId}/reprint`,
        { accessToken, method: "POST" },
      );
      if (requestId !== requestRef.current) return;
      setPrintable(ticket);
      setMessage("Ticket ready to print.");
    } catch (error) {
      if (requestId === requestRef.current) setMessage(errorMessage(error));
    } finally {
      if (requestId === requestRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function chooseExchangeShowtime(showtimeId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await releaseHold();
      exchangeRequestIdRef.current = crypto.randomUUID();
      exchangeHolderKeyRef.current = `staff-exchange-${crypto.randomUUID()}`;
      setExchangeShowtimeId(showtimeId);
      setExchangeSeatId("");
      setExchangeSeats([]);
      setExchangePriceMatches(true);
      if (!showtimeId || !exchangeTicket) return;
      const availability = await apiFetch<ExchangeAvailability>(`/cinema/showtimes/${showtimeId}/seats`);
      const priceMatches = availability.showtime.priceTier.ticketPriceMinor === exchangeTicket.priceCentsPaid;
      setExchangePriceMatches(priceMatches);
      setExchangeSeats(availability.seats.filter((seat) => seat.state === "AVAILABLE"));
      if (!priceMatches) setMessage("Choose a showtime with the same ticket price for this exchange.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function beginExchange(ticket: TicketOrder["tickets"][number]) {
    void releaseHold();
    setExchangeTicket(ticket);
    setExchangeShowtimeId("");
    setExchangeSeats([]);
    setExchangeSeatId("");
    setExchangeReason("");
    setExchangePriceMatches(true);
    setPrintable(null);
    setMessage(null);
    exchangeRequestIdRef.current = crypto.randomUUID();
    exchangeHolderKeyRef.current = `staff-exchange-${crypto.randomUUID()}`;
  }

  async function chooseExchangeSeat(seatId: string) {
    await releaseHold();
    exchangeRequestIdRef.current = crypto.randomUUID();
    exchangeHolderKeyRef.current = `staff-exchange-${crypto.randomUUID()}`;
    setExchangeSeatId(seatId);
    setMessage(null);
  }

  function changeExchangeReason(reason: string) {
    exchangeRequestIdRef.current = crypto.randomUUID();
    setExchangeReason(reason);
  }

  async function cancelExchange() {
    await releaseHold();
    setExchangeTicket(null);
    setExchangeShowtimeId("");
    setExchangeSeats([]);
    setExchangeSeatId("");
    setExchangeReason("");
    exchangeRequestIdRef.current = "";
    exchangeHolderKeyRef.current = "";
  }

  async function completeExchange(event: FormEvent) {
    event.preventDefault();
    if (!exchangeTicket || !exchangeShowtimeId || !exchangeSeatId || !exchangeReason.trim()) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const holderKey = exchangeHolderKeyRef.current || `staff-exchange-${crypto.randomUUID()}`;
    const requestId = exchangeRequestIdRef.current || crypto.randomUUID();
    exchangeHolderKeyRef.current = holderKey;
    exchangeRequestIdRef.current = requestId;
    try {
      let activeHold = activeHoldRef.current;
      if (!activeHold) {
        const holds = await apiFetch<Array<{ holdToken: string }>>(
          `/box-office/showtimes/${exchangeShowtimeId}/holds`,
          {
            accessToken,
            method: "POST",
            body: JSON.stringify({ seatIds: [exchangeSeatId], holderKey }),
          },
        );
        const hold = holds[0];
        if (!hold) throw new Error("The replacement seat could not be held.");
        activeHold = { showtimeId: exchangeShowtimeId, holdToken: hold.holdToken, holderKey };
        activeHoldRef.current = activeHold;
      }
      await apiFetch(`/box-office/tickets/${exchangeTicket.id}/exchange`, {
        accessToken,
        method: "POST",
        body: JSON.stringify({
          requestId,
          holdToken: activeHold.holdToken,
          holderKey,
          reason: exchangeReason.trim(),
        }),
      });
      activeHoldRef.current = null;
      setExchangeTicket(null);
      setExchangeShowtimeId("");
      setExchangeSeats([]);
      setExchangeSeatId("");
      setExchangeReason("");
      exchangeRequestIdRef.current = "";
      exchangeHolderKeyRef.current = "";
      setMessage("Ticket exchanged. Search again to view or print the replacement ticket.");
      setOrders([]);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ticket-service">
      <div className="ticket-service__heading">
        <div>
          <span className="eyebrow">BOX OFFICE</span>
          <h2>Ticket service</h2>
          <p>Find an order by number, guest name, or email and prepare a replacement ticket.</p>
        </div>
      </div>
      {message && (
        <div className={printable ? "scan-result valid" : "error-banner"} aria-live="polite">
          {message}
        </div>
      )}
      <form className="ticket-service__search" onSubmit={search}>
        <label className="field">
          <span>Order or guest</span>
          <input
            required
            minLength={2}
            maxLength={100}
            value={query}
            disabled={busy}
            placeholder="AT-… or guest email"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || query.trim().length < 2}>
          {busy ? "Searching…" : "Search tickets"}
        </button>
      </form>
      <div className="ticket-service__results">
        {orders.map((order) => (
          <article key={order.id}>
            <header>
              <div>
                <strong>{order.orderNumber}</strong>
                <span>
                  {order.guestName || order.customer?.name || order.guestEmail || order.customer?.email || "Walk-up customer"}
                </span>
              </div>
              <b>{order.status}</b>
            </header>
            <div className="ticket-service__receipt">
              <label className="field">
                <span>Receipt email</span>
                <input type="email" maxLength={320} disabled={busy} value={receiptEmails[order.id] ?? ""} onChange={(event) => { delete receiptAttemptRef.current[order.id]; setReceiptEmails((current) => ({ ...current, [order.id]: event.target.value })); }} />
              </label>
              <button type="button" className="secondary" disabled={busy || !receiptEmails[order.id]?.trim() || !["PAID", "EXCHANGED"].includes(order.status)} onClick={() => void resendReceipt(order)}>Resend tickets</button>
            </div>
            {order.tickets.map((ticket) => {
              const showtime = ticket.showtimeSeat.showtime;
              const printableStatus = ticket.status === "ISSUED" || ticket.status === "ADMITTED";
              return (
                <div className="ticket-service__ticket-row" key={ticket.id}>
                  <div>
                    <strong>{showtime.movie.title} · Seat {ticket.showtimeSeat.seat.label}</strong>
                    <span>
                      {new Date(showtime.startsAt).toLocaleString()} · {showtime.auditorium.name} · {ticket.ticketType.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !printableStatus}
                    onClick={() => void prepareReprint(ticket.id)}
                  >
                    {printableStatus ? "Prepare reprint" : ticket.status}
                  </button>
                  {canExchange && ticket.status === "ISSUED" && (
                    <button type="button" className="secondary" disabled={busy} onClick={() => beginExchange(ticket)}>
                      Exchange
                    </button>
                  )}
                </div>
              );
            })}
          </article>
        ))}
      </div>
      {exchangeTicket && (
        <form className="ticket-exchange" onSubmit={completeExchange}>
          <div>
            <span className="eyebrow">TICKET EXCHANGE</span>
            <h2>{exchangeTicket.showtimeSeat.showtime.movie.title} · Seat {exchangeTicket.showtimeSeat.seat.label}</h2>
            <p>Only same-price exchanges are supported. The original ticket is canceled after the replacement seat is secured.</p>
          </div>
          <label className="field">
            <span>Replacement showtime</span>
            <select value={exchangeShowtimeId} disabled={busy} onChange={(event) => void chooseExchangeShowtime(event.target.value)} required>
              <option value="">Choose a showtime</option>
              {movies.flatMap((movie) => movie.showtimes.map((showtime) => (
                <option key={showtime.id} value={showtime.id}>
                  {movie.title} · {new Date(showtime.startsAt).toLocaleString()} · {showtime.auditorium.name}
                </option>
              )))}
            </select>
          </label>
          <label className="field">
            <span>Replacement seat</span>
            <select value={exchangeSeatId} disabled={busy || !exchangePriceMatches || !exchangeShowtimeId} onChange={(event) => void chooseExchangeSeat(event.target.value)} required>
              <option value="">{exchangeSeats.length ? "Choose an available seat" : "No available seats loaded"}</option>
              {exchangeSeats.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Reason</span>
            <input value={exchangeReason} disabled={busy} maxLength={500} required placeholder="Customer requested a different showtime" onChange={(event) => changeExchangeReason(event.target.value)} />
          </label>
          <div className="ticket-exchange__actions">
            <button className="primary" disabled={busy || !exchangePriceMatches || !exchangeSeatId || !exchangeReason.trim()}>
              {busy ? "Completing exchange…" : "Complete exchange"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void cancelExchange()}>Cancel</button>
          </div>
        </form>
      )}
      {printable && (
        <section className="ticket-reprint" aria-label="Printable replacement ticket">
          <span className="eyebrow">REPLACEMENT TICKET</span>
          <h2>{printable.movie}</h2>
          <p>{new Date(printable.startsAt).toLocaleString()}</p>
          <p>{printable.auditorium} · Seat {printable.seat} · {printable.ticketType}</p>
          <QRCodeSVG value={printable.credential} size={220} level="M" includeMargin />
          <strong>{printable.orderNumber}</strong>
          <button type="button" className="primary ticket-reprint__print" onClick={() => window.print()}>
            Print replacement ticket
          </button>
        </section>
      )}
    </section>
  );
}
