"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AuthenticatedCustomer,
  CustomerAccountResponse,
  CustomerSessionResponse,
  CustomerTicketOrderSummary,
} from "@cinema/shared";
import { QRCodeSVG } from "qrcode.react";
import { LiveRestaurantTab } from "../components/live-restaurant-tab";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Mode = "login" | "register";
function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function hasUpcomingTicket(order: CustomerTicketOrderSummary) {
  return order.tickets.some(
    (ticket) =>
      new Date(ticket.startsAt).getTime() >= Date.now() &&
      ticket.status !== "CANCELED" &&
      ticket.status !== "REFUNDED",
  );
}

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [session, setSession] = useState<AuthenticatedCustomer | null>(null);
  const [account, setAccount] = useState<CustomerAccountResponse | null>(null);
  const [liveTabId, setLiveTabId] = useState("");
  const [tabLookup, setTabLookup] = useState("");
  const [guestTabToken, setGuestTabToken] = useState("");

  const upcomingOrders = useMemo(
    () => account?.orders.filter(hasUpcomingTicket) ?? [],
    [account],
  );
  const pastOrders = useMemo(
    () => account?.orders.filter((order) => !hasUpcomingTicket(order)) ?? [],
    [account],
  );

  async function requestAccount(allowRefresh: boolean): Promise<CustomerAccountResponse> {
    try {
      return await apiFetch<CustomerAccountResponse>("/auth/customers/me");
    } catch (err) {
      if (allowRefresh && err instanceof ApiRequestError && err.status === 401) {
        await apiFetch<CustomerSessionResponse>("/auth/customers/refresh", { method: "POST" });
        return apiFetch<CustomerAccountResponse>("/auth/customers/me");
      }
      throw err;
    }
  }

  useEffect(() => {
    void requestAccount(true)
      .then((response) => {
        setAccount(response);
        setSession(response.customer);
      })
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) {
          setError(err instanceof ApiRequestError ? err.body.message : "Your account could not be loaded.");
        }
      })
      .finally(() => setRestoring(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body = mode === "login" ? { email, password } : { email, password, name: name || undefined };
      const response = await apiFetch<CustomerSessionResponse>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSession(response.customer);
      setAccountLoading(true);
      const nextAccount = await requestAccount(false);
      setAccount(nextAccount);
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Please try again.");
    } finally {
      setAccountLoading(false);
      setLoading(false);
    }
  }

  async function signOut() {
    if (!session) return;
    try {
      await apiFetch<void>("/auth/customers/logout", {
        method: "POST",
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Sign out failed. Please try again.");
      return;
    }
    setSession(null);
    setAccount(null);
    setLiveTabId("");
    setError(null);
  }

  function renderOrders(title: string, orders: CustomerTicketOrderSummary[]) {
    return (
      <section className="account-orders" aria-label={title}>
        <div className="account-section-heading">
          <span className="eyebrow">MY TICKETS</span>
          <h2>{title}</h2>
        </div>
        {orders.length === 0 ? (
          <div className="content-panel account-empty">
            <p>{title === "Upcoming visits" ? "No upcoming tickets yet." : "No previous orders yet."}</p>
          </div>
        ) : orders.map((order) => (
          <article className="ticket-order" key={order.id}>
            <header className="ticket-order__header">
              <div>
                <span className="eyebrow">ORDER {order.orderNumber}</span>
                <h3>{order.locationName}</h3>
                <p>{statusLabel(order.status)} · Ordered {dateTime(order.createdAt)}</p>
              </div>
              <strong>{money(order.totalCents, order.currency)}</strong>
            </header>
            <div className="ticket-order__tickets">
              {order.tickets.map((ticket) => (
                <div className="account-ticket digital-ticket" key={ticket.id}>
                  <div className="account-ticket__details">
                    {ticket.moviePosterUrl && (
                      <img src={ticket.moviePosterUrl} alt={`${ticket.movieTitle} poster`} />
                    )}
                    <div>
                      <span className="eyebrow">{statusLabel(ticket.status)}</span>
                      <h4>{ticket.movieTitle}</h4>
                      <p>{dateTime(ticket.startsAt)}</p>
                      <p>{ticket.auditoriumName} · Seat {ticket.seatLabel}</p>
                      <p>{money(ticket.priceCentsPaid, order.currency)}</p>
                    </div>
                  </div>
                  <div className="ticket-qr" aria-label={`QR ticket for ${ticket.movieTitle}, seat ${ticket.seatLabel}`}>
                    <QRCodeSVG value={ticket.qrToken} size={150} level="M" marginSize={2} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (guestTabToken) {
    return (
      <main className="cinema-shell route-page">
        <LiveRestaurantTab guestToken={guestTabToken} onClose={() => setGuestTabToken("")} />
      </main>
    );
  }

  if (liveTabId && session) {
    return (
      <main className="cinema-shell route-page">
        <LiveRestaurantTab tabId={liveTabId} onClose={() => setLiveTabId("")} />
      </main>
    );
  }

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">YOUR VISIT</span>
        <h1>Account</h1>
        <p>Your tickets, receipts, and live dining tabs in one place.</p>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {restoring ? (
        <div className="content-panel"><p>Loading your account…</p></div>
      ) : session ? (
        <div className="account-dashboard">
          <section className="content-panel account-session-bar">
            <div>
              <span className="eyebrow">SIGNED IN</span>
              <h2>{account?.customer.name ?? session.name ?? session.email}</h2>
              <p className="secondary-copy">{account?.customer.email ?? session.email}</p>
            </div>
            <button className="account-secondary-button" onClick={signOut}>Sign out</button>
          </section>

          {accountLoading && !account ? (
            <div className="content-panel"><p>Loading your tickets…</p></div>
          ) : (
            <>
              {renderOrders("Upcoming visits", upcomingOrders)}
              {renderOrders("Order history", pastOrders)}
            </>
          )}

          <section className="content-panel dining-tab-panel">
            <div>
              <span className="eyebrow">DURING YOUR VISIT</span>
              <h2>Open a dining tab</h2>
              <p className="secondary-copy">Enter the tab ID shown on your ticket or provided by your server.</p>
            </div>
            <div>
              <label className="field">
                <span>Tab ID</span>
                <input value={tabLookup} onChange={(event) => setTabLookup(event.target.value)} />
              </label>
              <button className="primary" disabled={!tabLookup.trim()} onClick={() => setLiveTabId(tabLookup.trim())}>
                View live tab
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="account-grid">
          <section className="content-panel">
            <span className="eyebrow">GUEST DINING</span>
            <h2>Open a dining tab</h2>
            <label className="field">
              <span>Secure tab link token</span>
              <input value={tabLookup} onChange={(event) => setTabLookup(event.target.value)} />
            </label>
            <button className="primary" disabled={!tabLookup.trim()} onClick={() => setGuestTabToken(tabLookup.trim())}>
              View live tab
            </button>
          </section>

          <section className="content-panel" aria-label="Customer account">
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            <p className="secondary-copy">See upcoming tickets, QR codes, and previous orders.</p>
            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
              )}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <button className="primary" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
