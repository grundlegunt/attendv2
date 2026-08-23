"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";

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
    memberships: Array<{ membershipNumber: string; tier: string; status: string }>;
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
  membership: { membershipNumber: string; tier: string; status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELED"; expiresAt: string | null } | null;
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
  const [membershipNumber, setMembershipNumber] = useState("");
  const [membershipTier, setMembershipTier] = useState("");
  const [membershipStatus, setMembershipStatus] = useState<"ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELED">("ACTIVE");
  const [membershipExpiresAt, setMembershipExpiresAt] = useState("");
  const [membershipSaving, setMembershipSaving] = useState(false);
  const membershipAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
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
      const next = await apiFetch<CustomerHistory>(`/management/customers/${customerId}`, { accessToken });
      setCustomerHistory(next);
      setMembershipNumber(next.membership?.membershipNumber ?? "");
      setMembershipTier(next.membership?.tier ?? "");
      setMembershipStatus(next.membership?.status ?? "ACTIVE");
      setMembershipExpiresAt(next.membership?.expiresAt?.slice(0, 10) ?? "");
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

  async function exportCustomerHistory() {
    if (!customerHistory) return;
    setError(null);
    try {
      const blob = await apiDownload(
        `/management/customers/${customerHistory.id}/history.csv`,
        { accessToken },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "customer-history.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError
          ? reason.body.message
          : "Customer history could not be exported.",
      );
    }
  }

  async function saveMembership(event: FormEvent) {
    event.preventDefault();
    if (!customerHistory || !membershipNumber.trim() || !membershipTier.trim()) return;
    setMembershipSaving(true);
    setError(null);
    const payload = { membershipNumber: membershipNumber.trim(), tier: membershipTier.trim(), status: membershipStatus, expiresAt: membershipExpiresAt ? `${membershipExpiresAt}T00:00:00.000Z` : null };
    const fingerprint = JSON.stringify({ customerId: customerHistory.id, ...payload });
    if (membershipAttemptRef.current?.fingerprint !== fingerprint) membershipAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const membership = await apiFetch<CustomerHistory["membership"]>(`/management/customers/${customerHistory.id}/membership`, {
        method: "PATCH",
        accessToken,
        headers: { "Idempotency-Key": membershipAttemptRef.current.requestId },
        body: JSON.stringify(payload),
      });
      membershipAttemptRef.current = null;
      setCustomerHistory((current) => current ? { ...current, membership } : current);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "Membership could not be saved.");
    } finally {
      setMembershipSaving(false);
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
                      {customer.memberships[0] ? ` · Member #${customer.memberships[0].membershipNumber} · ${customer.memberships[0].tier}` : ""}
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
                    {employee.permissions.includes("ticket.price.edit") && (
                      <form className="customer-membership-form" onSubmit={(event) => void saveMembership(event)}>
                        <h4>External membership</h4>
                        <p>Record an existing cinema membership for lookup. Attend does not sell or renew memberships.</p>
                        <label><span>Membership number</span><input value={membershipNumber} maxLength={100} required onChange={(event) => setMembershipNumber(event.target.value)} /></label>
                        <label><span>Tier</span><input value={membershipTier} maxLength={100} required onChange={(event) => setMembershipTier(event.target.value)} /></label>
                        <label><span>Status</span><select value={membershipStatus} onChange={(event) => setMembershipStatus(event.target.value as typeof membershipStatus)}><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="CANCELED">Canceled</option></select></label>
                        <label><span>Expires (optional)</span><input type="date" value={membershipExpiresAt} onChange={(event) => setMembershipExpiresAt(event.target.value)} /></label>
                        <button className="primary" disabled={membershipSaving || !membershipNumber.trim() || !membershipTier.trim()}>{membershipSaving ? "Saving…" : customerHistory.membership ? "Update membership" : "Attach membership"}</button>
                      </form>
                    )}
                    <button
                      className="secondary customer-history-export"
                      type="button"
                      onClick={() => void exportCustomerHistory()}
                    >
                      Export complete history CSV
                    </button>
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
