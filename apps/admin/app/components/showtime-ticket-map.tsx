"use client";

import { useState } from "react";
import { SeatMap, type SeatMapSeat, type SeatMapSeatingStyle } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type TicketMap = {
  showtime: { id: string; currency: string; seatingStyle: SeatMapSeatingStyle };
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED"; ticket: { id: string; status: string; priceCentsPaid: number; ticketType: { name: string }; ticketOrder: { orderNumber: string; channel: string } } | null }>;
  counts: { available: number; held: number; sold: number; blocked: number };
};

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export function ShowtimeTicketMap({ showtimeId, accessToken }: { showtimeId: string; accessToken: string }) {
  const [open, setOpen] = useState(false);
  const [ticketMap, setTicketMap] = useState<TicketMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (ticketMap || loading) return;
    setLoading(true); setError(null);
    apiFetch<TicketMap>(`/reports/showtimes/${showtimeId}/ticket-map`, { accessToken })
      .then(setTicketMap)
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Ticket map could not be loaded."))
      .finally(() => setLoading(false));
  }

  const soldSeats = ticketMap?.seats.filter((seat) => seat.ticket) ?? [];
  return <><button type="button" className="showtime-ticket-map-toggle" aria-expanded={open} onClick={toggle}>{open ? "Hide ticket map" : "View ticket map"}</button>{open && <section className="showtime-ticket-map" aria-label="Showtime ticket map">{loading && <p>Loading ticket map…</p>}{error && <div className="error-banner" role="alert">{error}</div>}{ticketMap && <><SeatMap seats={ticketMap.seats.map((seat) => ({ ...seat, state: seat.state === "SOLD" ? "selected" : seat.state === "AVAILABLE" ? "available" : "unavailable" }))} seatingStyle={ticketMap.showtime.seatingStyle} label="Sold-seat map" /><div className="ticket-map-counts"><span>{ticketMap.counts.sold} sold</span><span>{ticketMap.counts.held} held</span><span>{ticketMap.counts.available} available</span><span>{ticketMap.counts.blocked} blocked</span></div>{soldSeats.length > 0 && <div className="sold-seat-ledger">{soldSeats.map((seat) => <div key={seat.id}><strong>{seat.label}</strong><span>{seat.ticket!.ticketType.name} · {money(seat.ticket!.priceCentsPaid, ticketMap.showtime.currency)}</span><small>{seat.ticket!.ticketOrder.orderNumber} · {seat.ticket!.ticketOrder.channel.toLowerCase()}</small></div>)}</div>}</>}</section>}</>;
}
