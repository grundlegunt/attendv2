"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse } from "@cinema/shared";
import {
  apiFetch,
  ApiRequestError,
  subscribeToStationEvents,
} from "./lib/api-client";

interface Station {
  id: string;
  name: string;
  displayType: string;
}

interface FulfillmentTicket {
  id: string;
  status: "NEW" | "ACCEPTED" | "PREPARING" | "READY";
  firedAt: string;
  tabLabel: string | null;
  auditoriumName: string | null;
  seatLabels: string[];
  serverName: string;
  refireCount: number;
  items: Array<{
    id: string;
    quantity: number;
    selectedModifiers: Array<{ name: string }>;
    allergyNotes: string | null;
    course: string | null;
    menuItem: { name: string };
  }>;
}

interface QueueResponse {
  station: Station;
  tickets: FulfillmentTicket[];
}

type FulfillmentAction =
  | "ACCEPT"
  | "START"
  | "READY"
  | "DELIVER"
  | "CANCEL"
  | "VOID";

type StaffLoginResponse = (AuthTokenResponse & { employee: AuthenticatedEmployee }) | { mfaRequired: true; challengeToken: string };
type ActiveStaffSession = AuthTokenResponse & { employee: AuthenticatedEmployee };
const STORAGE_KEY = "attend-kds-session";
const STATION_STORAGE_KEY = "attend-kds-station";

function ageClass(firedAt: string) {
  const ageMinutes = (Date.now() - new Date(firedAt).getTime()) / 60_000;
  if (ageMinutes >= 15) return "critical";
  if (ageMinutes >= 8) return "warning";
  return "fresh";
}

function elapsed(firedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(firedAt).getTime()) / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function KdsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState("");
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [restored, setRestored] = useState(false);

  function storeSession(next: ActiveStaffSession) {
    setEmployee(next.employee); setAccessToken(next.accessToken); setRefreshToken(next.refreshToken); setExpiresInSeconds(next.expiresInSeconds);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function refreshSession(token: string) {
    const next = await apiFetch<ActiveStaffSession>("/auth/staff/refresh", { method: "POST", body: JSON.stringify({ refreshToken: token }) });
    storeSession(next);
  }

  function signOut() {
    if (accessToken) void apiFetch("/auth/staff/logout", { accessToken, method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setEmployee(null); setAccessToken(""); setRefreshToken(""); setExpiresInSeconds(0); setStations([]); setStationId(""); setQueue(null);
  }

  function selectStation(nextStationId: string) {
    setStationId(nextStationId);
    setQueue(null);
    window.localStorage.setItem(STATION_STORAGE_KEY, nextStationId);
  }

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (!stored) { setRestored(true); return; }
    try {
      const parsed = JSON.parse(stored) as Partial<ActiveStaffSession>;
      if (!parsed.refreshToken) throw new Error("Stored session cannot be refreshed.");
      void refreshSession(parsed.refreshToken).catch(() => {
        window.sessionStorage.removeItem(STORAGE_KEY);
        setError("Your display session expired. Please sign in again.");
      }).finally(() => setRestored(true));
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY); setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    const timer = window.setTimeout(() => void refreshSession(refreshToken).catch(signOut), Math.max(5_000, (expiresInSeconds - 60) * 1_000));
    return () => window.clearTimeout(timer);
  }, [accessToken, expiresInSeconds, refreshToken]);

  const refresh = useCallback(async () => {
    if (!accessToken || !stationId) return;
    try {
      setQueue(
        await apiFetch<QueueResponse>(`/fulfillment/stations/${stationId}/queue`, {
          accessToken,
        }),
      );
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError
          ? reason.body.message
          : "The station queue could not refresh.",
      );
    }
  }, [accessToken, stationId]);

  useEffect(() => {
    if (!accessToken) return;
    apiFetch<Station[]>("/fulfillment/stations", { accessToken })
      .then((response) => {
        setStations(response);
        const remembered = window.localStorage.getItem(STATION_STORAGE_KEY);
        const nextStationId =
          response.find((station) => station.id === remembered)?.id ??
          response[0]?.id ??
          "";
        setStationId(nextStationId);
        if (nextStationId) {
          window.localStorage.setItem(STATION_STORAGE_KEY, nextStationId);
        } else {
          window.localStorage.removeItem(STATION_STORAGE_KEY);
        }
      })
      .catch(() => setError("No station is available for this account."));
  }, [accessToken]);

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 2_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!accessToken || !stationId) return;
    return subscribeToStationEvents(stationId, accessToken, () => void refresh());
  }, [accessToken, refresh, stationId]);

  const grouped = useMemo(
    () => ({
      active: queue?.tickets.filter((ticket) => ticket.status !== "READY") ?? [],
      ready: queue?.tickets.filter((ticket) => ticket.status === "READY") ?? [],
    }),
    [queue],
  );

  async function login(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiFetch<StaffLoginResponse>("/auth/staff/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if ("mfaRequired" in response) { setMfaChallengeToken(response.challengeToken); setPassword(""); return; }
      storeSession(response);
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError
          ? reason.body.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault(); setError(null); setLoading(true);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/mfa/verify", { method: "POST", body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode }) });
      storeSession(response); setMfaChallengeToken(null); setMfaCode("");
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The code could not be verified."); }
    finally { setLoading(false); }
  }

  async function transition(
    ticket: FulfillmentTicket,
    action: FulfillmentAction,
  ) {
    try {
      await apiFetch(`/fulfillment/tickets/${ticket.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({ action }),
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "Status did not update.");
    }
  }

  if (!restored) return <main className="auth-shell"><div className="auth-card"><p>Restoring display session…</p></div></main>;

  if (mfaChallengeToken) {
    return <main className="auth-shell"><div className="auth-card"><h1>Authenticator code</h1><p className="subtitle">Enter the current 6-digit code from your authenticator app.</p>{error && <div className="error-banner">{error}</div>}<form onSubmit={verifyMfa}>
      <div className="field"><label htmlFor="mfa-code">Authenticator code</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} /></div>
      <button className="primary" type="submit" disabled={loading}>{loading ? "Verifying…" : "Verify and sign in"}</button>
    </form></div></main>;
  }

  if (!employee) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1>Kitchen / Bar Display</h1>
          <p className="subtitle">Sign in to open this station</p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={login}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (employee.mfaSetupRequired) return <main className="auth-shell"><div className="auth-card"><h1>MFA setup required</h1><p className="subtitle">Sign in to Attend Admin to connect an authenticator app before opening this station.</p></div></main>;

  return (
    <main className="kds-shell">
      <header className="kds-header">
        <div>
          <span>ATTEND · LIVE FULFILLMENT</span>
          <h1>{queue?.station.name ?? "Select station"}</h1>
        </div>
        <label>
          Station
          <select value={stationId} onChange={(event) => selectStation(event.target.value)}>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>{station.name} · {station.displayType}</option>
            ))}
          </select>
        </label>
        <div><p>{employee.name}</p><button type="button" onClick={signOut}>Sign out</button></div>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <section className="queue-section">
        <h2>In progress · {grouped.active.length}</h2>
        <div className="ticket-grid">
          {grouped.active.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} onTransition={transition} />
          ))}
        </div>
      </section>
      <section className="queue-section ready-section">
        <h2>Ready · {grouped.ready.length}</h2>
        <div className="ticket-grid">
          {grouped.ready.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} onTransition={transition} />
          ))}
        </div>
      </section>
    </main>
  );
}

function TicketCard({
  ticket,
  now,
  onTransition,
}: {
  ticket: FulfillmentTicket;
  now: number;
  onTransition: (
    ticket: FulfillmentTicket,
    action: FulfillmentAction,
  ) => void;
}) {
  const next =
    ticket.status === "NEW"
      ? { action: "ACCEPT" as const, label: "Accept" }
      : ticket.status === "ACCEPTED"
        ? { action: "START" as const, label: "Start prep" }
        : ticket.status === "PREPARING"
          ? { action: "READY" as const, label: "Mark ready" }
          : { action: "DELIVER" as const, label: "Delivered" };
  return (
    <article className={`fulfillment-ticket ${ageClass(ticket.firedAt)}`}>
      <header>
        <strong>
          {ticket.seatLabels.length
            ? `${ticket.auditoriumName} · ${ticket.seatLabels.join(", ")}`
            : ticket.tabLabel ?? "Walk-in"}
        </strong>
        <time>{elapsed(ticket.firedAt, now)}</time>
      </header>
      <p className="ticket-meta">{ticket.serverName} · {ticket.status}{ticket.refireCount ? ` · REFIRE ${ticket.refireCount}` : ""}</p>
      <ul>
        {ticket.items.map((item) => (
          <li key={item.id}>
            <b>{item.quantity}× {item.menuItem.name}</b>
            {item.selectedModifiers.map((modifier) => <span key={modifier.name}>{modifier.name}</span>)}
            {item.course && <span>{item.course}</span>}
            {item.allergyNotes && <em>ALLERGY: {item.allergyNotes}</em>}
          </li>
        ))}
      </ul>
      <div className="ticket-actions">
        <button type="button" onClick={() => onTransition(ticket, next.action)}>
          {next.label}
        </button>
        <button
          className="destructive"
          type="button"
          onClick={() =>
            onTransition(ticket, ticket.status === "READY" ? "VOID" : "CANCEL")
          }
        >
          {ticket.status === "READY" ? "Void" : "Cancel"}
        </button>
      </div>
    </article>
  );
}
