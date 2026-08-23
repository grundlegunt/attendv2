"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type SearchResults = {
  query: string;
  orders: Array<{ id: string; orderNumber: string; status: string; totalCents: number; currency: string; guestName: string | null; guestEmail: string | null; customer: { name: string | null; email: string | null } | null; createdAt: string; _count: { tickets: number } }>;
  customers: Array<{ id: string; name: string | null; email: string | null; phone: string | null; _count: { ticketOrders: number } }>;
  tickets: Array<{ id: string; status: string; ticketOrder: { id: string; orderNumber: string }; ticketType: { name: string }; showtimeSeat: { seat: { label: string }; showtime: { startsAt: string; movie: { title: string }; auditorium: { name: string } } } }>;
  giftCards: Array<{ id: string; codeLast4: string; recipientName: string | null; recipientEmail: string | null; balanceCents: number; currency: string; status: string }>;
};

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

export default function GlobalSearchPage() {
  const { accessToken, employee } = useAdminSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) { setError("Enter at least two characters."); return; }
    const requestId = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const next = await apiFetch<SearchResults>(`/management/search?${new URLSearchParams({ query: normalized })}`, { accessToken });
      if (requestId === requestRef.current) setResults(next);
    } catch (reason) {
      if (requestId === requestRef.current) setError(reason instanceof ApiRequestError ? reason.body.message : "Search could not be completed.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  const count = results ? results.orders.length + results.customers.length + results.tickets.length + results.giftCards.length : 0;
  return <main className="admin-route-page"><section className="panel global-search"><p className="kicker">ADMIN SEARCH</p><h2>Find a customer record</h2><p>Search order numbers, customer names and emails, exact ticket credentials, or gift-card recipient details and last four digits.</p>
    <form className="global-search-form" onSubmit={(event) => void search(event)}><label><span className="sr-only">Search records</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order, customer, ticket, or gift card" autoFocus /></label><button className="primary" disabled={loading}>{loading ? "Searching…" : "Search"}</button></form>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {results && <div className="global-search-results"><p><strong>{count}</strong> results for “{results.query}”</p>
      <h3>Orders</h3>{results.orders.map((order) => <article key={order.id}><div><strong>{order.orderNumber}</strong><small>{order.customer?.name ?? order.guestName ?? "Guest"} · {order.customer?.email ?? order.guestEmail ?? "No email"}</small></div><div><strong>{money(order.totalCents, order.currency)}</strong><small>{order._count.tickets} tickets · {order.status}</small></div><Link href={`/refunds?query=${encodeURIComponent(order.orderNumber)}`}>Open order</Link></article>)}{!results.orders.length && <p className="dashboard-empty">No matching orders.</p>}
      <h3>Customers</h3>{results.customers.map((customer) => <article key={customer.id}><div><strong>{customer.name ?? "Guest"}</strong><small>{customer.email ?? "No email"}{customer.phone ? ` · ${customer.phone}` : ""}</small></div><span>{customer._count.ticketOrders} orders</span></article>)}{!results.customers.length && <p className="dashboard-empty">No matching customers.</p>}
      <h3>Tickets</h3>{results.tickets.map((ticket) => <article key={ticket.id}><div><strong>{ticket.showtimeSeat.showtime.movie.title} · {ticket.showtimeSeat.seat.label}</strong><small>{ticket.ticketType.name} · {ticket.status} · {new Date(ticket.showtimeSeat.showtime.startsAt).toLocaleString([], { timeZone: employee.timezone })}</small></div><Link href={`/refunds?query=${encodeURIComponent(ticket.ticketOrder.orderNumber)}`}>{ticket.ticketOrder.orderNumber}</Link></article>)}{!results.tickets.length && <p className="dashboard-empty">No exact ticket match.</p>}
      <h3>Gift cards</h3>{results.giftCards.map((card) => <article key={card.id}><div><strong>Card ending {card.codeLast4}</strong><small>{card.recipientName ?? "No recipient name"} · {card.recipientEmail ?? "No recipient email"}</small></div><div><strong>{money(card.balanceCents, card.currency)}</strong><small>{card.status}</small></div><Link href="/gift-cards">Open gift cards</Link></article>)}{!results.giftCards.length && <p className="dashboard-empty">No matching gift cards.</p>}
    </div>}
  </section></main>;
}
