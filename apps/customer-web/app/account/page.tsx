"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { downloadTicketCalendar } from "../lib/ticket-calendar";

type Mode = "login" | "register" | "forgot" | "reset";
function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}

function dateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
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
  const [resetToken, setResetToken] = useState("");
  const passwordResetAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const passwordResetRequestAttemptRef = useRef<{ email: string; requestId: string } | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const registrationAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [restoring, setRestoring] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const receiptAttemptRef = useRef<Record<string, string>>({});
  const receiptPendingRef = useRef<string | null>(null);
  const [signOutPending, setSignOutPending] = useState(false);
  const signOutPendingRef = useRef(false);
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const passwordChangeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);
  const passwordPendingRef = useRef(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const profileAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [profilePending, setProfilePending] = useState(false);
  const profilePendingRef = useRef(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const emailChangeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [emailChangeToken, setEmailChangeToken] = useState("");
  const emailConfirmationAttemptRef = useRef<{ token: string; requestId: string } | null>(null);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const emailChangePendingRef = useRef(false);
  const [emailChangeMessage, setEmailChangeMessage] = useState<string | null>(null);
  const [session, setSession] = useState<AuthenticatedCustomer | null>(null);
  const [account, setAccount] = useState<CustomerAccountResponse | null>(null);
  const [liveTabId, setLiveTabId] = useState("");
  const [tabLookup, setTabLookup] = useState("");
  const [guestTabToken, setGuestTabToken] = useState("");

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const passwordResetToken = hash.get("resetPassword");
    if (passwordResetToken) {
      setResetToken(passwordResetToken);
      setMode("reset");
    }
    const emailToken = hash.get("emailChange");
    if (emailToken) setEmailChangeToken(emailToken);
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

  useEffect(() => {
    if (account?.customer.name) setProfileName(account.customer.name);
  }, [account?.customer.name]);

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
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const path =
        mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, name: name || undefined };
      const fingerprint = JSON.stringify(body);
      if (mode === "register" && registrationAttemptRef.current?.fingerprint !== fingerprint) registrationAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
      const response = await apiFetch<CustomerSessionResponse>(path, {
        method: "POST",
        headers: mode === "register" ? { "Idempotency-Key": registrationAttemptRef.current!.requestId } : undefined,
        body: fingerprint,
      });
      if (mode === "register") registrationAttemptRef.current = null;
      setSession(response.customer);
      setAccountLoading(true);
      const nextAccount = await requestAccount(false);
      setAccount(nextAccount);
      setPassword("");
    } catch (err) {
      if (mode === "register" && err instanceof ApiRequestError && err.status < 500) registrationAttemptRef.current = null;
      setError(
        err instanceof ApiRequestError ? err.body.message : "Please try again.",
      );
    } finally {
      setAccountLoading(false);
      loadingRef.current = false;
      setLoading(false);
    }
  }

  async function requestPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(null);
    setRecoveryMessage(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (passwordResetRequestAttemptRef.current?.email !== normalizedEmail) passwordResetRequestAttemptRef.current = { email: normalizedEmail, requestId: crypto.randomUUID() };
    setLoading(true);
    try {
      await apiFetch<{ accepted: true }>("/auth/customers/password-reset/request", {
        method: "POST",
        headers: { "Idempotency-Key": passwordResetRequestAttemptRef.current.requestId },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      passwordResetRequestAttemptRef.current = null;
      setRecoveryMessage(
        "If an account exists for that email, a password reset link is on its way.",
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) passwordResetRequestAttemptRef.current = null;
      setError(
        err instanceof ApiRequestError ? err.body.message : "Please try again.",
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  async function confirmPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (loadingRef.current) return;
    setError(null);
    setRecoveryMessage(null);
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }
    loadingRef.current = true;
    const fingerprint = JSON.stringify({ token: resetToken, newPassword: password });
    if (passwordResetAttemptRef.current?.fingerprint !== fingerprint) passwordResetAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    setLoading(true);
    try {
      await apiFetch<{ reset: true }>("/auth/customers/password-reset/confirm", {
        method: "POST",
        headers: { "Idempotency-Key": passwordResetAttemptRef.current.requestId },
        body: fingerprint,
      });
      passwordResetAttemptRef.current = null;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setResetToken("");
      setPassword("");
      setPasswordConfirmation("");
      setMode("login");
      setRecoveryMessage("Password updated. You can sign in now.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) passwordResetAttemptRef.current = null;
      setError(
        err instanceof ApiRequestError ? err.body.message : "Please try again.",
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  async function signOut() {
    if (!session || signOutPendingRef.current) return;
    signOutPendingRef.current = true;
    setSignOutPending(true);
    try {
      await apiFetch<void>("/auth/customers/logout", {
        method: "POST",
      });
      setSession(null);
      setAccount(null);
      setLiveTabId("");
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.body.message
          : "Sign out failed. Please try again.",
      );
      return;
    } finally {
      signOutPendingRef.current = false;
      setSignOutPending(false);
    }
  }

  async function resendReceipt(order: CustomerTicketOrderSummary) {
    if (receiptPendingRef.current) return;
    receiptPendingRef.current = order.id;
    const requestId = receiptAttemptRef.current[order.id] ?? crypto.randomUUID();
    receiptAttemptRef.current[order.id] = requestId;
    setReceiptOrderId(order.id);
    setReceiptMessage(null);
    try {
      const result = await apiFetch<{ receiptDelivery: "SENT" | "FAILED"; email: string }>(
        `/auth/customers/orders/${order.id}/receipt`,
        { method: "POST", headers: { "Idempotency-Key": requestId } },
      );
      if (result.receiptDelivery === "SENT") delete receiptAttemptRef.current[order.id];
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
      if (receiptPendingRef.current === order.id) {
        receiptPendingRef.current = null;
        setReceiptOrderId(null);
      }
    }
  }

  function printOrder(orderId: string) {
    setPrintOrderId(orderId);
    window.requestAnimationFrame(() => window.print());
  }

  function downloadOrderCalendar(order: CustomerTicketOrderSummary) {
    downloadTicketCalendar(
      order.orderNumber,
      order.tickets
        .filter((ticket) => !["CANCELED", "REFUNDED"].includes(ticket.status))
        .map((ticket) => ({
          id: ticket.id,
          movie: ticket.movieTitle,
          auditorium: ticket.auditoriumName,
          seat: ticket.seatLabel,
          startsAt: ticket.startsAt,
          endsAt: ticket.endsAt,
        })),
    );
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwordPendingRef.current) return;
    passwordPendingRef.current = true;
    const fingerprint = JSON.stringify({ currentPassword, newPassword });
    if (passwordChangeAttemptRef.current?.fingerprint !== fingerprint) passwordChangeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    setPasswordPending(true);
    setPasswordMessage(null);
    try {
      const response = await apiFetch<CustomerSessionResponse>("/auth/customers/change-password", {
        method: "POST",
        headers: { "Idempotency-Key": passwordChangeAttemptRef.current.requestId },
        body: fingerprint,
      });
      passwordChangeAttemptRef.current = null;
      setSession(response.customer);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("Password updated. Your other sessions have been signed out.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) passwordChangeAttemptRef.current = null;
      setPasswordMessage(
        err instanceof ApiRequestError ? err.body.message : "Your password could not be updated.",
      );
    } finally {
      passwordPendingRef.current = false;
      setPasswordPending(false);
    }
  }

  async function updateProfile(event: FormEvent) {
    event.preventDefault();
    if (profilePendingRef.current) return;
    profilePendingRef.current = true;
    const fingerprint = JSON.stringify({ name: profileName.trim() });
    if (profileAttemptRef.current?.fingerprint !== fingerprint) profileAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    setProfilePending(true);
    setProfileMessage(null);
    try {
      const customer = await apiFetch<AuthenticatedCustomer>("/auth/customers/me", {
        method: "PATCH",
        headers: { "Idempotency-Key": profileAttemptRef.current.requestId },
        body: fingerprint,
      });
      profileAttemptRef.current = null;
      setSession(customer);
      setAccount((current) => current ? { ...current, customer } : current);
      setProfileName(customer.name ?? "");
      setProfileMessage("Profile updated.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) profileAttemptRef.current = null;
      setProfileMessage(
        err instanceof ApiRequestError ? err.body.message : "Your profile could not be updated.",
      );
    } finally {
      profilePendingRef.current = false;
      setProfilePending(false);
    }
  }

  async function requestEmailChange(event: FormEvent) {
    event.preventDefault();
    if (emailChangePendingRef.current) return;
    emailChangePendingRef.current = true;
    const fingerprint = JSON.stringify({ newEmail: newEmail.trim().toLowerCase(), password: emailChangePassword });
    if (emailChangeAttemptRef.current?.fingerprint !== fingerprint) emailChangeAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    setEmailChangePending(true);
    setEmailChangeMessage(null);
    try {
      await apiFetch<{ accepted: true }>("/auth/customers/email-change/request", {
        method: "POST",
        headers: { "Idempotency-Key": emailChangeAttemptRef.current.requestId },
        body: fingerprint,
      });
      emailChangeAttemptRef.current = null;
      setNewEmail("");
      setEmailChangePassword("");
      setEmailChangeMessage("Check the new address for a confirmation link.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) emailChangeAttemptRef.current = null;
      setEmailChangeMessage(
        err instanceof ApiRequestError ? err.body.message : "The email change could not be started.",
      );
    } finally {
      emailChangePendingRef.current = false;
      setEmailChangePending(false);
    }
  }

  async function confirmEmailChange(event: FormEvent) {
    event.preventDefault();
    if (emailChangePendingRef.current) return;
    emailChangePendingRef.current = true;
    if (emailConfirmationAttemptRef.current?.token !== emailChangeToken) emailConfirmationAttemptRef.current = { token: emailChangeToken, requestId: crypto.randomUUID() };
    setEmailChangePending(true);
    setEmailChangeMessage(null);
    try {
      await apiFetch<{ changed: true }>("/auth/customers/email-change/confirm", {
        method: "POST",
        headers: { "Idempotency-Key": emailConfirmationAttemptRef.current.requestId },
        body: JSON.stringify({ token: emailChangeToken }),
      });
      emailConfirmationAttemptRef.current = null;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setEmailChangeToken("");
      setSession(null);
      setAccount(null);
      setMode("login");
      setRecoveryMessage("Email updated. Sign in with your new address.");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status < 500) emailConfirmationAttemptRef.current = null;
      setEmailChangeMessage(
        err instanceof ApiRequestError ? err.body.message : "The email change could not be confirmed.",
      );
    } finally {
      emailChangePendingRef.current = false;
      setEmailChangePending(false);
    }
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
                    {dateTime(order.createdAt, order.locationTimezone)}
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
                  <button
                    className="account-secondary-button"
                    type="button"
                    disabled={!order.tickets.some((ticket) => !["CANCELED", "REFUNDED"].includes(ticket.status))}
                    onClick={() => downloadOrderCalendar(order)}
                  >
                    Add to calendar
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
                        <p>{dateTime(ticket.startsAt, order.locationTimezone)}</p>
                        <p>
                          {ticket.auditoriumName} · Seat {ticket.seatLabel}
                        </p>
                        <p>{ticket.ticketTypeName}</p>
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

  if (emailChangeToken) {
    return (
      <main className="cinema-shell route-page">
        <section className="route-heading">
          <span className="eyebrow">ACCOUNT SECURITY</span>
          <h1>Confirm email change</h1>
          <p>Confirm this address as your new sign-in email. The link expires after 30 minutes.</p>
        </section>
        <section className="content-panel" aria-label="Confirm email change">
          <form onSubmit={confirmEmailChange}>
            <button className="primary" type="submit" disabled={emailChangePending}>
              {emailChangePending ? "Confirming…" : "Confirm email change"}
            </button>
          </form>
          {emailChangeMessage && <p role="status">{emailChangeMessage}</p>}
        </section>
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
      ) : session && mode !== "reset" ? (
        <div className="account-dashboard">
          <section className="content-panel account-session-bar">
            <div>
              <span className="eyebrow">{copy.signedInEyebrow}</span>
              <h2>{account?.customer.name ?? session.name ?? session.email}</h2>
              <p className="secondary-copy">
                {account?.customer.email ?? session.email}
              </p>
            </div>
            <button className="account-secondary-button" onClick={signOut} disabled={signOutPending}>
              {signOutPending ? "Signing out…" : "Sign out"}
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

          <section className="content-panel account-password-panel">
            <div>
              <span className="eyebrow">ACCOUNT DETAILS</span>
              <h2>Profile</h2>
              <p className="secondary-copy">
                This name appears with your account and ticket communications.
              </p>
            </div>
            <form onSubmit={updateProfile}>
              <label className="field">
                <span>Name</span>
                <input
                  autoComplete="name"
                  required
                  minLength={1}
                  maxLength={100}
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </label>
              <button className="account-secondary-button" disabled={profilePending || !profileName.trim()}>
                {profilePending ? "Saving…" : "Save profile"}
              </button>
              {profileMessage && <p role="status">{profileMessage}</p>}
            </form>
            <form onSubmit={requestEmailChange}>
              <label className="field">
                <span>New sign-in email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={emailChangePassword}
                  onChange={(event) => setEmailChangePassword(event.target.value)}
                />
              </label>
              <button className="account-secondary-button" disabled={emailChangePending || !newEmail || !emailChangePassword}>
                {emailChangePending ? "Sending…" : "Verify new email"}
              </button>
              {emailChangeMessage && <p role="status">{emailChangeMessage}</p>}
            </form>
          </section>

          <section className="content-panel account-password-panel">
            <div>
              <span className="eyebrow">ACCOUNT SECURITY</span>
              <h2>Change password</h2>
              <p className="secondary-copy">Updating your password signs out other browser sessions.</p>
            </div>
            <form onSubmit={changePassword}>
              <label className="field">
                <span>Current password</span>
                <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </label>
              <label className="field">
                <span>New password</span>
                <input type="password" autoComplete="new-password" required minLength={8} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </label>
              <button className="account-secondary-button" disabled={passwordPending || newPassword.length < 8}>
                {passwordPending ? "Updating…" : "Update password"}
              </button>
              {passwordMessage && <p role="status">{passwordMessage}</p>}
            </form>
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
            <h2>
              {mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Reset password"
                    : "Choose a new password"}
            </h2>
            <p className="secondary-copy">
              {mode === "forgot"
                ? "Enter your account email and we’ll send a secure reset link."
                : mode === "reset"
                  ? "This reset link can be used once and expires after 30 minutes."
                  : "See upcoming tickets, QR codes, and previous orders."}
            </p>
            {recoveryMessage && <p role="status">{recoveryMessage}</p>}
            <form
              onSubmit={
                mode === "forgot"
                  ? requestPasswordReset
                  : mode === "reset"
                    ? confirmPasswordReset
                    : handleSubmit
              }
            >
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
              {mode !== "reset" && <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>}
              {mode !== "forgot" && <div className="field">
                <label htmlFor="password">
                  {mode === "reset" ? "New password" : "Password"}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>}
              {mode === "reset" && (
                <div className="field">
                  <label htmlFor="password-confirmation">Confirm new password</label>
                  <input
                    id="password-confirmation"
                    type="password"
                    required
                    minLength={8}
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                  />
                </div>
              )}
              <button className="primary" type="submit" disabled={loading}>
                {loading
                  ? "Please wait…"
                  : mode === "login"
                    ? "Sign in"
                    : mode === "register"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Update password"}
              </button>
            </form>
            {mode === "login" && (
              <button className="link" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
            )}
            {mode === "forgot" ? (
              <button className="link" onClick={() => setMode("login")}>
                Back to sign in
              </button>
            ) : mode !== "reset" && (
              <button
                className="link"
                onClick={() => setMode(mode === "register" ? "login" : "register")}
              >
                {mode === "register"
                  ? "Already registered? Sign in"
                  : "Need an account? Register"}
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
