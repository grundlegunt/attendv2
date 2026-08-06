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
interface OrganizationDetail {
  id: string; name: string; legalName: string | null; timezone: string; createdAt: string;
  payments: { connected: boolean; onboardingStatus: string };
  locations: Array<{
    id: string; name: string; address: string | null; timezone: string; currency: string; active: boolean;
    branding: { logoUrl: string | null; accentColor: string | null; accentMutedColor: string | null; backgroundColor: string | null; surfaceColor: string | null; textColor: string | null; mutedTextColor: string | null };
    operations: { ticketTaxRateBasisPoints: number; preShowBufferMinutes: number; cleaningBufferMinutes: number; checkDropMinutesBeforeEnd: number; autoSettleGraceMinutes: number; timeClockEnabled: boolean };
    configuration: { auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number; activeMovies: number; activeFilmSeries: number };
  }>;
}

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
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [organizationLoading, setOrganizationLoading] = useState(false);
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

  useEffect(() => {
    if (!session || !selectedOrganizationId) { setOrganization(null); return; }
    setOrganizationLoading(true); setError(null);
    request<OrganizationDetail>(`/platform/organizations/${selectedOrganizationId}`, undefined, session.accessToken)
      .then(setOrganization)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load this cinema."))
      .finally(() => setOrganizationLoading(false));
  }, [selectedOrganizationId, session]);

  async function login(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); }
  }

  function signOut() {
    window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOverview(null); setSelectedOrganizationId(null); setOrganization(null); setError(null);
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

  const locations = overview?.organizations.flatMap((item) => item.locations) ?? [];
  return <main className="shell">
    <header><div><p className="eyebrow">ATTEND MASTER</p><h1>{selectedOrganizationId ? "Cinema profile" : "Client operations"}</h1><p className="muted">Company visibility across cinema clients. Cinema staff retain control of their own operations.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    {error && <div className="error">{error}</div>}
    {selectedOrganizationId && <section className="detail-shell">
      <button className="back" onClick={() => setSelectedOrganizationId(null)}>← All cinema clients</button>
      {organizationLoading && <p className="muted">Loading cinema profile…</p>}
      {organization && <>
        <div className="detail-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>{organization.name}</h2><p className="muted">{organization.legalName ?? "Legal name not configured"} · Client since {new Date(organization.createdAt).toLocaleDateString()}</p></div><span className={organization.payments.connected ? "status good" : "status warning"}>{organization.payments.connected ? `Payments ${organization.payments.onboardingStatus.toLowerCase()}` : "Payments not connected"}</span></div>
        {organization.locations.map((location) => <article className="location-detail" key={location.id}>
          <div className="location-detail-heading"><div><div className="location-title"><h3>{location.name}</h3><span className={location.active ? "dot active" : "dot"}>{location.active ? "Active" : "Inactive"}</span></div><p className="muted">{location.address ?? "Address not configured"} · {location.timezone}</p></div><div className="actions horizontal"><a href={CINEMA_ADMIN_URL} target="_blank" rel="noreferrer">Open cinema admin ↗</a><a href={CUSTOMER_WEB_URL} target="_blank" rel="noreferrer">Open customer site ↗</a></div></div>
          <div className="readiness-grid">
            <section><p className="eyebrow">READINESS</p><div className="metric-grid"><span><b>{location.configuration.auditoriums}</b> Auditoriums</span><span><b>{location.configuration.activeMovies}</b> Active movies</span><span><b>{location.configuration.activeFilmSeries}</b> Film series</span><span><b>{location.configuration.upcomingShowtimes}</b> Upcoming shows</span><span><b>{location.configuration.menuItems}</b> Menu items</span><span><b>{location.configuration.employees}</b> Active staff</span></div></section>
            <section><p className="eyebrow">CUSTOMER BRAND</p><div className="brand-preview" style={{ background: location.branding.backgroundColor ?? "#090a0c", color: location.branding.textColor ?? "#f5f2ea", borderColor: location.branding.accentColor ?? "#7c9cff" }}><span className="brand-mark" style={{ background: location.branding.accentColor ?? "#7c9cff" }} />{location.branding.logoUrl ? <span>Custom logo configured</span> : <span>Text identity · {location.name}</span>}</div><div className="swatches">{[["Accent", location.branding.accentColor], ["Background", location.branding.backgroundColor], ["Surface", location.branding.surfaceColor], ["Text", location.branding.textColor]].map(([label, color]) => <span key={label}><i style={{ background: color ?? "transparent" }} />{label}<code>{color ?? "Default"}</code></span>)}</div></section>
            <section><p className="eyebrow">OPERATING SETTINGS</p><dl><div><dt>Ticket tax</dt><dd>{(location.operations.ticketTaxRateBasisPoints / 100).toFixed(2)}%</dd></div><div><dt>Pre-show buffer</dt><dd>{location.operations.preShowBufferMinutes} min</dd></div><div><dt>Cleaning buffer</dt><dd>{location.operations.cleaningBufferMinutes} min</dd></div><div><dt>Check drop</dt><dd>{location.operations.checkDropMinutesBeforeEnd} min before end</dd></div><div><dt>Auto-settle grace</dt><dd>{location.operations.autoSettleGraceMinutes} min</dd></div><div><dt>Time clock</dt><dd>{location.operations.timeClockEnabled ? "Enabled" : "Disabled"}</dd></div></dl></section>
          </div>
          <footer className="detail-note">Configuration changes are made in this cinema’s admin interface and remain scoped to its staff permissions.</footer>
        </article>)}
      </>}
    </section>}
    {!selectedOrganizationId && <>
    <section className="summary">
      <div><strong>{overview?.organizations.length ?? "—"}</strong><span>Organizations</span></div>
      <div><strong>{locations.length || "—"}</strong><span>Locations</span></div>
      <div><strong>{locations.filter((location) => location.active).length || "—"}</strong><span>Active locations</span></div>
      <div><strong>{locations.reduce((sum, location) => sum + location.configuration.upcomingShowtimes, 0) || "—"}</strong><span>Upcoming showtimes</span></div>
    </section>
    <section className="organizations">
      {!overview && !error && <p className="muted">Loading cinema clients…</p>}
      {overview?.organizations.map((organizationItem) => <article className="organization" key={organizationItem.id}>
        <div className="org-heading"><div><p className="eyebrow">ORGANIZATION</p><h2>{organizationItem.name}</h2><p className="muted">{organizationItem.legalName ?? organizationItem.timezone}</p></div><div className="org-actions"><span className={organizationItem.payments.connected ? "status good" : "status warning"}>{organizationItem.payments.connected ? `Payments ${organizationItem.payments.onboardingStatus.toLowerCase()}` : "Payments not connected"}</span><button className="open-client" onClick={() => setSelectedOrganizationId(organizationItem.id)}>Open cinema →</button></div></div>
        <div className="location-list">{organizationItem.locations.map((location) => <div className="location" key={location.id}>
          <div><div className="location-title"><h3>{location.name}</h3><span className={location.active ? "dot active" : "dot"}>{location.active ? "Active" : "Inactive"}</span></div><p className="muted">{location.address ?? location.timezone}</p><code>{location.id}</code></div>
          <div className="signals">
            <span><b>{location.configuration.auditoriums}</b> auditoriums</span><span><b>{location.configuration.employees}</b> staff</span><span><b>{location.configuration.menuItems}</b> menu items</span><span><b>{location.configuration.upcomingShowtimes}</b> upcoming</span><span className={location.configuration.branding ? "configured" : "needs-attention"}>{location.configuration.branding ? "Brand configured" : "Default brand"}</span>
          </div>
          <div className="actions"><a href={CINEMA_ADMIN_URL} target="_blank" rel="noreferrer">Cinema admin ↗</a><a href={CUSTOMER_WEB_URL} target="_blank" rel="noreferrer">Customer site ↗</a></div>
        </div>)}</div>
      </article>)}
    </section>
    </>}
  </main>;
}
