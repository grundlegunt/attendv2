"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";

interface Session { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } }
interface Organization { id: string; name: string }
interface Overview { organizations: Organization[] }
interface Actor { id: string; name: string; email: string }
interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: Actor | null;
  organization: Organization | null;
  location: { name: string } | null;
  beforeState: unknown;
  afterState: unknown;
}
interface AuditResponse { total: number; actors: Actor[]; events: AuditEvent[] }

async function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(typeof body.message === "string" ? body.message : "Request failed.");
  }
  return response.json() as Promise<T>;
}

function stateSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 4);
  return entries.length ? entries.map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ") : null;
}

export default function PlatformAuditLog() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [organizationId, setOrganizationId] = useState("");
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setSession(JSON.parse(stored) as Session); } catch { window.sessionStorage.removeItem(STORAGE_KEY); }
    }
    setRestored(true);
  }, []);

  const loadEvents = useCallback(async (currentSession: Session, filters?: { organizationId: string; actorId: string; action: string; from: string; to: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filters?.organizationId) params.set("organizationId", filters.organizationId);
      if (filters?.actorId) params.set("actorId", filters.actorId);
      if (filters?.action) params.set("action", filters.action);
      if (filters?.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters?.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
      const result = await request<AuditResponse>(`/platform/audit-events?${params}`, undefined, currentSession.accessToken);
      setEvents(result.events);
      setTotal(result.total);
      setActors(result.actors);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the audit log.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!session) return;
    void Promise.all([
      request<Overview>("/platform/overview", undefined, session.accessToken).then((result) => setOrganizations(result.organizations)),
      loadEvents(session),
    ]).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load audit filters."));
  }, [session, loadEvents]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (session) void loadEvents(session, { organizationId, actorId, action, from, to });
  }

  function clearFilters() {
    setOrganizationId(""); setActorId(""); setAction(""); setFrom(""); setTo("");
    if (session) void loadEvents(session);
  }

  function signOut() {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null); setEvents([]); setError(null);
  }

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) return <main className="center"><form className="login-card" onSubmit={login}><p className="eyebrow">ATTEND MASTER</p><h1>Company sign in</h1><p className="muted">Separate from every cinema&apos;s staff account.</p>{error && <div className="error">{error}</div>}<label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button type="submit">Sign in</button></form></main>;

  return (
    <main className="shell">
      <header><div><p className="eyebrow">ATTEND MASTER</p><h1>Audit Log</h1><p className="muted">Review company-side changes across every cinema client.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
      <nav className="platform-nav" aria-label="Attend Master"><Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link href="/onboarding">Onboarding</Link><Link href="/payments">Payments</Link><Link href="/content">Content</Link><Link href="/branding">Branding</Link>{session.user.role === "OWNER" && <Link href="/team">Team</Link>}<Link className="active" href="/audit">Audit Log</Link></nav>
      {error && <div className="error">{error}</div>}
      <form className="audit-filters" onSubmit={applyFilters}>
        <label>Client<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="">All clients</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
        <label>Operator<select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="">All operators</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
        <label>Action<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. content_published" /></label>
        <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="audit-filter-actions"><button disabled={loading} type="submit">{loading ? "Loading…" : "Apply"}</button><button className="quiet" type="button" onClick={clearFilters}>Clear</button></div>
      </form>
      <div className="audit-result-heading"><strong>{total}</strong><span>matching platform event{total === 1 ? "" : "s"}{total > 100 ? " · showing latest 100" : ""}</span></div>
      <section className="audit-list">
        {!loading && events.length === 0 && <p className="empty-state">No platform events match these filters.</p>}
        {events.map((event) => {
          const summary = stateSummary(event.afterState) ?? stateSummary(event.beforeState);
          return <article key={event.id}><time>{new Date(event.occurredAt).toLocaleString()}</time><div><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actor?.name ?? "Unknown operator"} · {event.organization?.name ?? "Attend"}{event.location ? ` / ${event.location.name}` : ""}</span>{summary && <small>{summary}</small>}</div><span className="status">{event.entityType}</span></article>;
        })}
      </section>
    </main>
  );
}
