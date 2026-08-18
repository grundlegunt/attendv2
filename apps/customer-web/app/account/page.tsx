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
import { useCinemaContent } from "../components/customer-branding";

type Mode = "login" | "register";
function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
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
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
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
  const { account: copy } = useCinemaContent();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [session, setSession] = useState<AuthenticatedCustomer | null>(null);
  const [account, setAccount] = useState<CustomerAccountResponse | null>(null);
  const [liveTabId, setLiveTabId] = useState("");
  const [tabLookup, setTabLookup] = useState("");
  const [guestTabToken, setGuestTabToken] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const token = search.get("restaurantTab");
    if (token) setGuestTabToken(token);

    if (search.get("createAccount") === "1") {
      setMode("register");
      const serialized = window.sessionStorage.getItem("attend-account-handoff");
      if (!serialized) return;
      window.sessionStorage.removeItem("attend-account-handoff");
      try {
        const handoff = JSON.parse(serialized) as { email?: unknown; name?: unknown };
        if (typeof handoff.email === "string") setEmail(handoff.email);
        if (typeof handoff.name === "string") setName(handoff.name);
      } catch {
        // Ignore an invalid or stale handoff and leave registration editable.
      }
    }
  }, []);

  useEffect(() => {
    if (!printOrderId) return;
    document.body.classList.add("ticket-order-printing");
    const reset = () => setPrintOrderId(null);
    window.addEventListener("afterprint", reset);
    return () => {
      document.body.classList.remove("ticket-order-printing");
      window.removeEventListener("afterprint", reset);
    };
  }, [printOrderId]);

  const upcomingOrders = useMemo(
    () => account?.orders.filter(hasUpcomingTicket) ?? [],
    [account],
  );
  const pastOrders = useMemo(
    () => account?.orders.filter((order) => !hasUpcomingTicket(order)) ?? [],
    [account],
  );

  async function requestAccount(
    allowRefresh: boolean,
  ): Promise<CustomerAccountResponse> {
    try {
      return await apiFetch<CustomerAccountResponse>("/auth/customers/me");
    } catch (err) {
      if (
        allowRefresh &&
        err instanceof ApiRequestError &&
        err.status === 401
      ) {
        await apiFetch<CustomerSessionResponse>("/auth/customers/refresh", {
          method: "POST",
        });
        return apiFetch<CustomerAccountResponse>("/auth/customers/me");
      }
      throw err;
    }
  }

  useEffect(() => {
    setRestoreError(null);
    setRestoring(true);

    void requestAccount(true)
      .then((response) => {
        setAccount(response);
        setSession(response.customer);
      })
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 401)) {
          setRestoreError(
            err instanceof ApiRequestError
              ? err.body.message
              : "Your account could not be loaded.",
          );
        }
      })
      .finally(() => setRestoring(false));
  }, [restoreAttempt]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path =
        mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, name: name || undefined };
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
      setError(
        err instanceof ApiRequestError ? err.body.message : "Please try again.",
      );
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
      setError(
        err instanceof ApiRequestError
          ? err.body.message
          : "Sign out failed. Please try again.",
      );
      return;
    }
    setSession(null);
    setAccount(null);
    setLiveTabId("");
    setError(null);
  }

  async function resendReceipt(order: CustomerTicketOrderSummary) {
    setReceiptOrderId(order.id);
    setReceiptMessage(null);
    try {
      const result = await apiFetch<{ receiptDelivery: "SENT" | "FAILED"; email: string }>(
        `/auth/customers/orders/${order.id}/receipt`,
        { method: "POST" },
      );
      setReceiptMessage(
        result.receiptDelivery === "SENT"
          ? `Tickets for order ${order.orderNumber} were sent to ${result.email}.`
          : `We could not email order ${order.orderNumber}. Your QR tickets remain available below.`,
      );
    } catch (err) {
      setReceiptMessage(
        err instanceof ApiRequestError ? err.body.message : "The ticket email could not be sent.",
      );
    } finally {
      setReceiptOrderId(null);
    }
  }

  function printOrder(orderId: string) {
    setPrintOrderId(orderId);
    window.requestAnimationFrame(() => window.print());
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
            <p>
              {title === "Upcoming visits"
                ? "No upcoming tickets yet."
                : "No previous orders yet."}
            </p>
          </div>
        ) : (
          orders.map((order) => (
            <article className={`ticket-order${printOrderId === order.id ? " ticket-order--printing" : ""}`} key={order.id}>
              <header className="ticket-order__header">
                <div>
                  <span className="eyebrow">ORDER {order.orderNumber}</span>
                  <h3>{order.locationName}</h3>
                  <p>
                    {statusLabel(order.status)} · Ordered{" "}
                    {dateTime(order.createdAt)}
                  </p>
                </div>
                <div>
                  <strong>{money(order.totalCents, order.currency)}</strong>
                  <button
                    className="account-secondary-button"
                    type="button"
                    disabled={receiptOrderId === order.id || !["PAID", "EXCHANGED"].includes(order.status)}
                    onClick={() => void resendReceipt(order)}
                  >
                    {receiptOrderId === order.id ? "Sending…" : "Email tickets"}
                  </button>
                  <button
                    className="account-secondary-button"
                    type="button"
                    onClick={() => printOrder(order.id)}
                  >
                    Print tickets
                  </button>
                </div>
              </header>
              <div className="ticket-order__tickets">
                {order.tickets.map((ticket) => (
                  <div
                    className="account-ticket digital-ticket"
                    key={ticket.id}
                  >
                    <div className="account-ticket__details">
                      {ticket.moviePosterUrl && (
                        <img
                          src={ticket.moviePosterUrl}
                          alt={`${ticket.movieTitle} poster`}
                        />
                      )}
                      <div>
                        <span className="eyebrow">
                          {statusLabel(ticket.status)}
                        </span>
                        <h4>{ticket.movieTitle}</h4>
                        <p>{dateTime(ticket.startsAt)}</p>
                        <p>
                          {ticket.auditoriumName} · Seat {ticket.seatLabel}
                        </p>
                        <p>{money(ticket.priceCentsPaid, order.currency)}</p>
                      </div>
                    </div>
                    <div
                      className="ticket-qr"
                      aria-label={`QR ticket for ${ticket.movieTitle}, seat ${ticket.seatLabel}`}
                    >
                      <QRCodeSVG
                        value={ticket.qrToken}
                        size={150}
                        level="M"
                        marginSize={2}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    );
  }

  if (guestTabToken) {
    return (
      <main className="cinema-shell route-page">
        <LiveRestaurantTab
          guestToken={guestTabToken}
          onClose={() => setGuestTabToken("")}
        />
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
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {restoreError && <><div className="error-banner">{restoreError}</div><button className="primary" type="button" onClick={() => setRestoreAttempt((attempt) => attempt + 1)}>Retry account loading</button></>}

      {restoring ? (
        <div className="content-panel">
          <p>{copy.loading}</p>
        </div>
      ) : session ? (
        <div className="account-dashboard">
          <section className="content-panel account-session-bar">
            <div>
              <span className="eyebrow">{copy.signedInEyebrow}</span>
              <h2>{account?.customer.name ?? session.name ?? session.email}</h2>
              <p className="secondary-copy">
                {account?.customer.email ?? session.email}
              </p>
            </div>
            <button className="account-secondary-button" onClick={signOut}>
              Sign out
            </button>
          </section>

          {accountLoading && !account ? (
            <div className="content-panel">
              <p>Loading your tickets…</p>
            </div>
          ) : (
            <>
              {receiptMessage && <div className="content-panel" role="status">{receiptMessage}</div>}
              {renderOrders("Upcoming visits", upcomingOrders)}
              {renderOrders("Order history", pastOrders)}
            </>
          )}

          <section className="content-panel dining-tab-panel">
            <div>
              <span className="eyebrow">{copy.visitEyebrow}</span>
              <h2>Open a dining tab</h2>
              <p className="secondary-copy">
                Enter the tab ID shown on your ticket or provided by your
                server.
              </p>
            </div>
            <div>
              <label className="field">
                <span>Tab ID</span>
                <input
                  value={tabLookup}
                  onChange={(event) => setTabLookup(event.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!tabLookup.trim()}
                onClick={() => setLiveTabId(tabLookup.trim())}
              >
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
              <input
                value={tabLookup}
                onChange={(event) => setTabLookup(event.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={!tabLookup.trim()}
              onClick={() => setGuestTabToken(tabLookup.trim())}
            >
              View live tab
            </button>
          </section>

          <section className="content-panel" aria-label="Customer account">
            <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
            <p className="secondary-copy">
              See upcoming tickets, QR codes, and previous orders.
            </p>
            <form onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <button className="primary" type="submit" disabled={loading}>
                {loading
                  ? "Please wait…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>
            <button
              className="link"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login"
                ? "Need an account? Register"
                : "Already registered? Sign in"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
