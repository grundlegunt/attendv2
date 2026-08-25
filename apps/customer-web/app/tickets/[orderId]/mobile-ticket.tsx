"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { MobileTicketAccessResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../../lib/api-client";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function MobileTicket({ orderId }: { orderId: string }) {
  const [tickets, setTickets] = useState<MobileTicketAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storageKey = `attend-mobile-ticket:${orderId}`;
    const fragment = window.location.hash.startsWith("#token=")
      ? new URLSearchParams(window.location.hash.slice(1)).get("token")
      : null;
    const token = fragment ?? window.sessionStorage.getItem(storageKey);
    if (fragment) {
      window.sessionStorage.setItem(storageKey, fragment);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (!token) {
      setError("This mobile-ticket link is incomplete. Open the full link from your ticket message.");
      return;
    }

    const controller = new AbortController();
    apiFetch<MobileTicketAccessResponse>(`/ticketing/mobile-orders/${encodeURIComponent(orderId)}/access`, {
      method: "POST",
      body: JSON.stringify({ token }),
      signal: controller.signal,
    })
      .then(setTickets)
      .catch((reason) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiRequestError && reason.status === 404) {
          window.sessionStorage.removeItem(storageKey);
        }
        setError(reason instanceof ApiRequestError
          ? reason.body.message
          : "Mobile tickets could not be loaded. Please try again.");
      });
    return () => controller.abort();
  }, [orderId]);

  if (error) {
    return <div className="error-banner" role="alert">{error}</div>;
  }
  if (!tickets) {
    return <p className="mobile-ticket-status" role="status">Loading your tickets…</p>;
  }

  return (
    <section className="mobile-ticket-wallet" aria-labelledby="mobile-ticket-heading">
      <span className="eyebrow">MOBILE TICKETS</span>
      <h1 id="mobile-ticket-heading">Your tickets</h1>
      <p>Confirmation <strong>{tickets.orderNumber}</strong></p>
      <div className="mobile-ticket-wallet__cards">
        {tickets.tickets.map((ticket) => (
          <article className="confirmation-card digital-ticket" key={ticket.id}>
            <div>
              <h2>{ticket.movie}</h2>
              <p>{new Intl.DateTimeFormat("en-US", {
                timeZone: tickets.timeZone,
                weekday: "long",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(ticket.startsAt))}</p>
              <p>{ticket.auditorium} · {ticket.seat === "General admission" ? ticket.seat : `Seat ${ticket.seat}`}</p>
              <p>{ticket.ticketType}</p>
            </div>
            <div className="ticket-qr" aria-label={`Admission QR code for ${ticket.seat}`}>
              <QRCodeSVG value={ticket.issuanceToken} size={220} level="M" marginSize={2} />
            </div>
          </article>
        ))}
      </div>
      <p className="mobile-ticket-wallet__total">Order total: <strong>{money(tickets.totalCents, tickets.currency)}</strong></p>
    </section>
  );
}
