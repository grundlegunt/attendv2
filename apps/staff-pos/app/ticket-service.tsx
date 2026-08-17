"use client";

import { FormEvent, useRef, useState } from "react";
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

export function TicketService({ accessToken }: { accessToken: string }) {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [printable, setPrintable] = useState<PrintableTicket | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);

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
    const requestId = ++requestRef.current;
    setBusy(true);
    setMessage(null);
    setPrintable(null);
    try {
      const results = await apiFetch<TicketOrder[]>(
        `/box-office/orders?q=${encodeURIComponent(normalized)}`,
        { accessToken },
      );
      if (requestId !== requestRef.current) return;
      setOrders(results);
      if (!results.length) setMessage("No ticket orders match this search.");
    } catch (error) {
      if (requestId === requestRef.current) {
        setOrders([]);
        setMessage(errorMessage(error));
      }
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }

  async function prepareReprint(ticketId: string) {
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
      if (requestId === requestRef.current) setBusy(false);
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
                </div>
              );
            })}
          </article>
        ))}
      </div>
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
