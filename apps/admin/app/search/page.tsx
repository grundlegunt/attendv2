"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type SearchResults = {
  query: string;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    currency: string;
    guestName: string | null;
    guestEmail: string | null;
    customer: { name: string | null; email: string | null } | null;
    createdAt: string;
    _count: { tickets: number };
  }>;
  customers: Array<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    _count: { ticketOrders: number; restaurantTabs: number };
  }>;
  tickets: Array<{
    id: string;
    status: string;
    ticketOrder: { id: string; orderNumber: string };
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
  giftCards: Array<{
    id: string;
    codeLast4: string;
    recipientName: string | null;
    recipientEmail: string | null;
    balanceCents: number;
    currency: string;
    status: string;
  }>;
};

type CustomerHistory = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  isGuest: boolean;
  createdAt: string;
  summary: {
    orderCount: number;
    ticketCount: number;
    lifetimeSpendCents: number;
    currency: string;
    diningVisitCount: number;
    diningSpendCents: number;
    diningCurrency: string;
  };
  historyWindow: {
    ticketOrdersShown: number;
    ticketOrdersTotal: number;
    diningVisitsShown: number;
    diningVisitsTotal: number;
  };
  ticketOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    channel: string;
    totalCents: number;
    currency: string;
    guestName: string | null;
    guestEmail: string | null;
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
  }>;
  restaurantTabs: Array<{
    id: string;
    label: string | null;
    status: string;
    fulfillmentMode: string;
    totalCents: number | null;
    prepaidCents: number;
    openedAt: string;
    closedAt: string | null;
    location: { currency: string };
    showtime: { movie: { title: string }; auditorium: { name: string } } | null;
    seats: Array<{ showtimeSeat: { seat: { label: string } } }>;
    orders: Array<{
      items: Array<{ quantity: number; menuItem: { name: string } }>;
    }>;
  }>;
};

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

export default function GlobalSearchPage() {
  const { accessToken, employee } = useAdminSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerHistory, setCustomerHistory] = useState<CustomerHistory | null>(null);
  const [customerLoadingId, setCustomerLoadingId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState<"tickets" | "dining" | null>(null);
  const requestRef = useRef(0);

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) {
      setError("Enter at least two characters.");
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await apiFetch<SearchResults>(`/management/search?${new URLSearchParams({ query: normalized })}`, { accessToken });
      if (requestId === requestRef.current) {
        setResults(next);
        setCustomerHistory(null);
      }
    } catch (reason) {
      if (requestId === requestRef.current) setError(reason instanceof ApiRequestError ? reason.body.message : "Search could not be completed.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  async function openCustomer(customerId: string) {
    if (customerHistory?.id === customerId) {
      setCustomerHistory(null);
      return;
    }
    setCustomerLoadingId(customerId);
    setError(null);
    try {
      setCustomerHistory(
        await apiFetch<CustomerHistory>(`/management/customers/${customerId}`, {
          accessToken,
        }),
      );
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "Customer history could not be loaded.");
    } finally {
      setCustomerLoadingId(null);
    }
  }

  async function loadOlder(kind: "tickets" | "dining") {
    if (!customerHistory) return;
    setHistoryLoading(kind);
    setError(null);
    const query = new URLSearchParams({
      ticketOffset: String(kind === "tickets" ? customerHistory.ticketOrders.length : 0),
      diningOffset: String(kind === "dining" ? customerHistory.restaurantTabs.length : 0),
    });
    try {
      const next = await apiFetch<CustomerHistory>(`/management/customers/${customerHistory.id}?${query}`, { accessToken });
      setCustomerHistory((current) =>
        current?.id === next.id
          ? {
              ...current,
              ticketOrders: kind === "tickets" ? [...current.ticketOrders, ...next.ticketOrders] : current.ticketOrders,
              restaurantTabs: kind === "dining" ? [...current.restaurantTabs, ...next.restaurantTabs] : current.restaurantTabs,
              historyWindow:
                kind === "tickets"
                  ? {
                      ...current.historyWindow,
                      ticketOrdersShown: next.historyWindow.ticketOrdersShown,
                    }
                  : {
                      ...current.historyWindow,
                      diningVisitsShown: next.historyWindow.diningVisitsShown,
                    },
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "Older customer history could not be loaded.");
    } finally {
      setHistoryLoading(null);
    }
  }

  const count = results ? results.orders.length + results.customers.length + results.tickets.length + results.giftCards.length : 0;
  return (
    <main className="admin-route-page">
      <section className="panel global-search">
        <p className="kicker">ADMIN SEARCH</p>
        <h2>Find a customer record</h2>
        <p>Search order numbers, customer names and emails, exact ticket credentials, or gift-card recipient details and last four digits.</p>
        <form className="global-search-form" onSubmit={(event) => void search(event)}>
          <label>
            <span className="sr-only">Search records</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order, customer, ticket, or gift card" autoFocus />
          </label>
          <button className="primary" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {results && (
          <div className="global-search-results">
            <p>
              <strong>{count}</strong> results for “{results.query}”
            </p>
            <h3>Orders</h3>
            {results.orders.map((order) => (
              <article key={order.id}>
                <div>
                  <strong>{order.orderNumber}</strong>
                  <small>
                    {order.customer?.name ?? order.guestName ?? "Guest"} · {order.customer?.email ?? order.guestEmail ?? "No email"}
                  </small>
                </div>
                <div>
                  <strong>{money(order.totalCents, order.currency)}</strong>
                  <small>
                    {order._count.tickets} tickets · {order.status}
                  </small>
                </div>
                <Link href={`/refunds?query=${encodeURIComponent(order.orderNumber)}`}>Open order</Link>
              </article>
            ))}
            {!results.orders.length && <p className="dashboard-empty">No matching orders.</p>}
            <h3>Customers</h3>
            {results.customers.map((customer) => (
              <div className="customer-search-record" key={customer.id}>
                <article>
                  <div>
                    <strong>{customer.name ?? "Guest"}</strong>
                    <small>
                      {customer.email ?? "No email"}
                      {customer.phone ? ` · ${customer.phone}` : ""}
                    </small>
                  </div>
                  <span>
                    {customer._count.ticketOrders} ticket orders · {customer._count.restaurantTabs} dining visits
                  </span>
                  <button className="secondary" type="button" onClick={() => void openCustomer(customer.id)} disabled={customerLoadingId === customer.id}>
                    {customerLoadingId === customer.id ? "Loading…" : customerHistory?.id === customer.id ? "Close history" : "View history"}
                  </button>
                </article>
                {customerHistory?.id === customer.id && (
                  <section className="customer-history">
                    <div className="customer-history-summary">
                      <div>
                        <strong>{customerHistory.summary.orderCount}</strong>
                        <small>Ticket orders</small>
                      </div>
                      <div>
                        <strong>{customerHistory.summary.ticketCount}</strong>
                        <small>Tickets</small>
                      </div>
                      <div>
                        <strong>{money(customerHistory.summary.lifetimeSpendCents, customerHistory.summary.currency)}</strong>
                        <small>Ticket spend</small>
                      </div>
                      <div>
                        <strong>{customerHistory.summary.diningVisitCount}</strong>
                        <small>Dining visits</small>
                      </div>
                      <div>
                        <strong>{money(customerHistory.summary.diningSpendCents, customerHistory.summary.diningCurrency)}</strong>
                        <small>Dining spend</small>
                      </div>
                      <div>
                        <strong>{customerHistory.isGuest ? "Guest" : "Account"}</strong>
                        <small>Customer type</small>
                      </div>
                    </div>
                    <h4>Ticket history</h4>
                    {customerHistory.historyWindow.ticketOrdersShown < customerHistory.historyWindow.ticketOrdersTotal && (
                      <p className="history-window-note">
                        Showing the latest {customerHistory.historyWindow.ticketOrdersShown} of {customerHistory.historyWindow.ticketOrdersTotal} ticket orders.
                        <button type="button" className="secondary" disabled={historyLoading !== null} onClick={() => void loadOlder("tickets")}>
                          {historyLoading === "tickets" ? "Loading…" : "Load older"}
                        </button>
                      </p>
                    )}
                    {customerHistory.ticketOrders.map((order) => (
                      <div className="customer-history-order" key={order.id}>
                        <div>
                          <strong>{order.orderNumber}</strong>
                          <small>
                            {new Date(order.createdAt).toLocaleString([], {
                              timeZone: employee.timezone,
                            })}{" "}
                            · {order.channel} · {order.status}
                          </small>
                        </div>
                        <div>
                          {order.tickets.map((ticket) => (
                            <small key={ticket.id}>
                              {ticket.showtimeSeat.showtime.movie.title} · {ticket.showtimeSeat.seat.label} · {ticket.ticketType.name}
                            </small>
                          ))}
                        </div>
                        <strong>{money(order.totalCents, order.currency)}</strong>
                        <Link href={`/refunds?query=${encodeURIComponent(order.orderNumber)}`}>Open order</Link>
                      </div>
                    ))}
                    {!customerHistory.ticketOrders.length && <p className="dashboard-empty">No ticket purchases at this location.</p>}
                    <h4>Dining history</h4>
                    {customerHistory.historyWindow.diningVisitsShown < customerHistory.historyWindow.diningVisitsTotal && (
                      <p className="history-window-note">
                        Showing the latest {customerHistory.historyWindow.diningVisitsShown} of {customerHistory.historyWindow.diningVisitsTotal} dining visits.
                        <button type="button" className="secondary" disabled={historyLoading !== null} onClick={() => void loadOlder("dining")}>
                          {historyLoading === "dining" ? "Loading…" : "Load older"}
                        </button>
                      </p>
                    )}
                    {customerHistory.restaurantTabs.map((tab) => (
                      <div className="customer-history-order" key={tab.id}>
                        <div>
                          <strong>{tab.label ?? tab.showtime?.movie.title ?? "Dining visit"}</strong>
                          <small>
                            {new Date(tab.openedAt).toLocaleString([], {
                              timeZone: employee.timezone,
                            })}{" "}
                            · {tab.fulfillmentMode.replaceAll("_", " ")} · {tab.status}
                          </small>
                        </div>
                        <div>
                          {tab.orders
                            .flatMap((order) => order.items)
                            .map((item, index) => (
                              <small key={`${item.menuItem.name}-${index}`}>
                                {item.quantity}× {item.menuItem.name}
                              </small>
                            ))}
                          {tab.seats.length > 0 && <small>Seats {tab.seats.map((seat) => seat.showtimeSeat.seat.label).join(", ")}</small>}
                        </div>
                        <strong>{tab.totalCents === null ? "Open" : money(tab.totalCents, tab.location.currency)}</strong>
                        <span>{tab.showtime?.auditorium.name ?? "Counter"}</span>
                      </div>
                    ))}
                    {!customerHistory.restaurantTabs.length && <p className="dashboard-empty">No dining visits at this location.</p>}
                  </section>
                )}
              </div>
            ))}
            {!results.customers.length && <p className="dashboard-empty">No matching customers.</p>}
            <h3>Tickets</h3>
            {results.tickets.map((ticket) => (
              <article key={ticket.id}>
                <div>
                  <strong>
                    {ticket.showtimeSeat.showtime.movie.title} · {ticket.showtimeSeat.seat.label}
                  </strong>
                  <small>
                    {ticket.ticketType.name} · {ticket.status} · {new Date(ticket.showtimeSeat.showtime.startsAt).toLocaleString([], { timeZone: employee.timezone })}
                  </small>
                </div>
                <Link href={`/refunds?query=${encodeURIComponent(ticket.ticketOrder.orderNumber)}`}>{ticket.ticketOrder.orderNumber}</Link>
              </article>
            ))}
            {!results.tickets.length && <p className="dashboard-empty">No exact ticket match.</p>}
            <h3>Gift cards</h3>
            {results.giftCards.map((card) => (
              <article key={card.id}>
                <div>
                  <strong>Card ending {card.codeLast4}</strong>
                  <small>
                    {card.recipientName ?? "No recipient name"} · {card.recipientEmail ?? "No recipient email"}
                  </small>
                </div>
                <div>
                  <strong>{money(card.balanceCents, card.currency)}</strong>
                  <small>{card.status}</small>
                </div>
                <Link href="/gift-cards">Open gift cards</Link>
              </article>
            ))}
            {!results.giftCards.length && <p className="dashboard-empty">No matching gift cards.</p>}
          </div>
        )}
      </section>
    </main>
  );
}
