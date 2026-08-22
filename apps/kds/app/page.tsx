"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type StaffLoginResponse = AuthTokenResponse & { employee: AuthenticatedEmployee };
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
  const [queueStale, setQueueStale] = useState(true);
  const [lastQueueUpdateAt, setLastQueueUpdateAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [restored, setRestored] = useState(false);
  const transitioningTicketIdsRef = useRef(new Set<string>());
  const transitionAttemptRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const queueRefreshPendingRef = useRef(false);
  const queueRefreshRequestRef = useRef(0);
  const [transitioningTicketIds, setTransitioningTicketIds] = useState<string[]>([]);

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
    queueRefreshRequestRef.current += 1; queueRefreshPendingRef.current = false;
    setEmployee(null); setAccessToken(""); setRefreshToken(""); setExpiresInSeconds(0); setStations([]); setStationId(""); setQueue(null);
  }

  function selectStation(nextStationId: string) {
    queueRefreshRequestRef.current += 1;
    queueRefreshPendingRef.current = false;
    setStationId(nextStationId);
    setQueue(null);
    setQueueStale(true);
    setLastQueueUpdateAt(null);
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
    if (!accessToken || !stationId || queueRefreshPendingRef.current) return;
    queueRefreshPendingRef.current = true;
    const requestId = ++queueRefreshRequestRef.current;
    try {
      const response = await apiFetch<QueueResponse>(
        `/fulfillment/stations/${stationId}/queue`,
        {
          accessToken,
        },
      );
      if (requestId !== queueRefreshRequestRef.current) return;
      setQueue(response);
      setQueueStale(false);
      setLastQueueUpdateAt(Date.now());
      setError(null);
    } catch (reason) {
      if (requestId !== queueRefreshRequestRef.current) return;
      setQueueStale(true);
      setError(
        reason instanceof ApiRequestError
          ? reason.body.message
          : "The station queue could not refresh.",
      );
    } finally {
      if (requestId === queueRefreshRequestRef.current) queueRefreshPendingRef.current = false;
    }
  }, [accessToken, stationId]);

  useEffect(() => {
    if (!accessToken) return;
    setError(null);
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
          setError(
            "No active kitchen or bar station is configured for this cinema. Add one in Admin → Menu, then reload this display.",
          );
        }
      })
      .catch((reason) => {
        setStations([]);
        setStationId("");
        if (reason instanceof ApiRequestError) {
          if (reason.status === 401) {
            setError("Your display session expired. Please sign in again.");
            return;
          }
          if (reason.status === 403) {
            setError(
              "This account cannot operate a kitchen display. Assign it the Kitchen, Bartender, Runner, Owner, or General Manager role in Admin.",
            );
            return;
          }
          setError(reason.body.message);
          return;
        }
        setError("The station list could not be loaded. Check the API connection and try again.");
      });
  }, [accessToken]);

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 2_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      queueRefreshRequestRef.current += 1;
      queueRefreshPendingRef.current = false;
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

  async function transition(
    ticket: FulfillmentTicket,
    action: FulfillmentAction,
  ) {
    if (transitioningTicketIdsRef.current.has(ticket.id)) return;
    transitioningTicketIdsRef.current.add(ticket.id);
    setTransitioningTicketIds(Array.from(transitioningTicketIdsRef.current));
    const fingerprint = JSON.stringify({ ticketId: ticket.id, action });
    if (transitionAttemptRef.current?.fingerprint !== fingerprint) {
      transitionAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    try {
      await apiFetch(`/fulfillment/tickets/${ticket.id}`, {
        method: "PATCH",
        accessToken,
        body: JSON.stringify({ action, requestId: transitionAttemptRef.current.requestId }),
      });
      transitionAttemptRef.current = null;
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        transitionAttemptRef.current = null;
      }
      setError(reason instanceof ApiRequestError ? reason.body.message : "Status did not update.");
    } finally {
      transitioningTicketIdsRef.current.delete(ticket.id);
      setTransitioningTicketIds(Array.from(transitioningTicketIdsRef.current));
    }
  }

  if (!restored) return <main className="auth-shell"><div className="auth-card"><p>Restoring display session…</p></div></main>;

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

  return (
    <main className="kds-shell">
      <header className="kds-header">
        <div>
          <span>ATTEND · LIVE FULFILLMENT</span>
          <h1>{queue?.station.name ?? "Select station"}</h1>
          <p className={queueStale ? "queue-status stale" : "queue-status live"}>
            {queueStale
              ? queue
                ? "Connection interrupted · controls paused"
                : "Connecting to live queue…"
              : `Live · updated ${lastQueueUpdateAt ? elapsed(new Date(lastQueueUpdateAt).toISOString(), now) : "0:00"} ago`}
          </p>
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
      {queueStale && queue && (
        <div className="queue-stale-banner">
          <strong>Showing the last received queue.</strong>
          <span>Ticket actions will unlock automatically when the connection recovers.</span>
        </div>
      )}
      <section className="queue-section">
        <h2>In progress · {grouped.active.length}</h2>
        <div className="ticket-grid">
          {grouped.active.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} busy={transitioningTicketIds.includes(ticket.id)} unavailable={queueStale} onTransition={transition} />
          ))}
        </div>
      </section>
      <section className="queue-section ready-section">
        <h2>Ready · {grouped.ready.length}</h2>
        <div className="ticket-grid">
          {grouped.ready.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} now={now} busy={transitioningTicketIds.includes(ticket.id)} unavailable={queueStale} onTransition={transition} />
          ))}
        </div>
      </section>
    </main>
  );
}

function TicketCard({
  ticket,
  now,
  busy,
  unavailable,
  onTransition,
}: {
  ticket: FulfillmentTicket;
  now: number;
  busy: boolean;
  unavailable: boolean;
  onTransition: (
    ticket: FulfillmentTicket,
    action: FulfillmentAction,
  ) => void;
}) {
  const destructiveAction = ticket.status === "READY" ? "VOID" : "CANCEL";
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<
    "CANCEL" | "VOID" | null
  >(null);

  useEffect(() => {
    if (!pendingDestructiveAction) return;
    const timer = window.setTimeout(() => setPendingDestructiveAction(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [pendingDestructiveAction]);

  useEffect(() => setPendingDestructiveAction(null), [ticket.status]);

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
        <button type="button" disabled={busy || unavailable} onClick={() => onTransition(ticket, next.action)}>
          {unavailable ? "Waiting for connection" : busy ? "Updating…" : next.label}
        </button>
        <button
          className="destructive"
          type="button"
          disabled={busy || unavailable}
          onClick={() => {
            if (pendingDestructiveAction === destructiveAction) {
              setPendingDestructiveAction(null);
              onTransition(ticket, destructiveAction);
              return;
            }
            setPendingDestructiveAction(destructiveAction);
          }}
        >
          {pendingDestructiveAction === destructiveAction
            ? `Confirm ${destructiveAction === "VOID" ? "void" : "cancel"}`
            : destructiveAction === "VOID"
              ? "Void"
              : "Cancel"}
        </button>
      </div>
    </article>
  );
}
