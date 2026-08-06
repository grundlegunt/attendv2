"use client";

import { FormEvent, useEffect, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const CINEMA_ADMIN_URL = process.env.NEXT_PUBLIC_CINEMA_ADMIN_URL ?? "http://localhost:3003";
const CUSTOMER_WEB_URL = process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL ?? "http://localhost:3000";
const STORAGE_KEY = "attend-platform-session";

interface PlatformUser { id: string; name: string; email: string }
interface Session { accessToken: string; user: PlatformUser }
interface LocationOverview {
  id: string; name: string; address: string | null; timezone: string; active: boolean;
  configuration: { branding: boolean; auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number };
}
interface OrganizationOverview {
  id: string; name: string; legalName: string | null; timezone: string;
  payments: { connected: boolean; onboardingStatus: string };
  locations: LocationOverview[];
}
interface Overview { generatedAt: string; organizations: OrganizationOverview[] }

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

export default function AttendMaster() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
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

  useEffect(() => {
    if (!session) return;
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then(setOverview)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load clients."));
  }, [session]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
  }

  function signOut() {
    window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOverview(null); setError(null);
  }

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) return <main className="center"><form className="login-card" onSubmit={login}>
    <p className="eyebrow">ATTEND MASTER</p><h1>Company sign in</h1>
    <p className="muted">Separate from every cinema’s staff account.</p>
    {error && <div className="error">{error}</div>}
    <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button type="submit">Sign in</button>
  </form></main>;

  const locations = overview?.organizations.flatMap((organization) => organization.locations) ?? [];
  return <main className="shell">
    <header><div><p className="eyebrow">ATTEND MASTER</p><h1>Client operations</h1><p className="muted">Read-only company view across cinema clients.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    {error && <div className="error">{error}</div>}
    <section className="summary">
      <div><strong>{overview?.organizations.length ?? "—"}</strong><span>Organizations</span></div>
      <div><strong>{locations.length || "—"}</strong><span>Locations</span></div>
      <div><strong>{locations.filter((location) => location.active).length || "—"}</strong><span>Active locations</span></div>
      <div><strong>{locations.reduce((sum, location) => sum + location.configuration.upcomingShowtimes, 0) || "—"}</strong><span>Upcoming showtimes</span></div>
    </section>
    <section className="organizations">
      {!overview && !error && <p className="muted">Loading cinema clients…</p>}
      {overview?.organizations.map((organization) => <article className="organization" key={organization.id}>
        <div className="org-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>{organization.name}</h2><p className="muted">{organization.legalName ?? organization.timezone}</p></div><span className={organization.payments.connected ? "status good" : "status warning"}>{organization.payments.connected ? `Payments ${organization.payments.onboardingStatus.toLowerCase()}` : "Payments not connected"}</span></div>
        <div className="location-list">{organization.locations.map((location) => <div className="location" key={location.id}>
          <div><div className="location-title"><h3>{location.name}</h3><span className={location.active ? "dot active" : "dot"}>{location.active ? "Active" : "Inactive"}</span></div><p className="muted">{location.address ?? location.timezone}</p><code>{location.id}</code></div>
          <div className="signals">
            <span><b>{location.configuration.auditoriums}</b> auditoriums</span><span><b>{location.configuration.employees}</b> staff</span><span><b>{location.configuration.menuItems}</b> menu items</span><span><b>{location.configuration.upcomingShowtimes}</b> upcoming</span><span className={location.configuration.branding ? "configured" : "needs-attention"}>{location.configuration.branding ? "Brand configured" : "Default brand"}</span>
          </div>
          <div className="actions"><a href={CINEMA_ADMIN_URL} target="_blank" rel="noreferrer">Cinema admin ↗</a><a href={CUSTOMER_WEB_URL} target="_blank" rel="noreferrer">Customer site ↗</a></div>
        </div>)}</div>
      </article>)}
    </section>
  </main>;
}
