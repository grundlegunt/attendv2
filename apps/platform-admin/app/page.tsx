"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";

interface Session {
  accessToken: string;
  user: { id: string; name: string; email: string };
}

interface LocationOverview {
  id: string;
  name: string;
  active: boolean;
  configuration: {
    branding: boolean;
    auditoriums: number;
    employees: number;
    menuItems: number;
    upcomingShowtimes: number;
  };
}

interface OrganizationOverview {
  id: string;
  name: string;
  legalName: string | null;
  payments: { connected: boolean; onboardingStatus: string };
  locations: LocationOverview[];
}

interface Overview {
  generatedAt: string;
  organizations: OrganizationOverview[];
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

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export default function PlatformDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSession(JSON.parse(stored) as Session);
      } catch {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then(setOverview)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load platform health."));
  }, [session]);

  const metrics = useMemo(() => {
    const organizations = overview?.organizations ?? [];
    const locations = organizations.flatMap((organization) => organization.locations);
    return {
      clients: organizations.length,
      locations: locations.length,
      activeLocations: locations.filter((location) => location.active).length,
      connectedClients: organizations.filter((organization) => organization.payments.onboardingStatus === "COMPLETE").length,
      attentionClients: organizations.filter((organization) => organization.payments.onboardingStatus !== "COMPLETE"),
    };
  }, [overview]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign in failed.");
    }
  }

  function signOut() {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setOverview(null);
    setError(null);
  }

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) {
    return (
      <main className="center">
        <form className="login-card" onSubmit={login}>
          <p className="eyebrow">ATTEND MASTER</p>
          <h1>Company sign in</h1>
          <p className="muted">Separate from every cinema&apos;s staff account.</p>
          {error && <div className="error">{error}</div>}
          <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">ATTEND MASTER</p>
          <h1>Platform health</h1>
          <p className="muted">A cross-client view of onboarding and operating readiness.</p>
        </div>
        <div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div>
      </header>
      <nav className="platform-nav" aria-label="Attend Master">
        <Link className="active" href="/">Dashboard</Link>
        <Link href="/clients">Clients</Link>
        <Link href="/payments">Payments</Link>
      </nav>
      {error && <div className="error">{error}</div>}
      <section className="dashboard-summary" aria-label="Platform metrics">
        <article><span>Clients</span><strong>{metrics.clients}</strong><small>theater organizations</small></article>
        <article><span>Locations</span><strong>{metrics.locations}</strong><small>{metrics.activeLocations} active</small></article>
        <article><span>Stripe ready</span><strong>{metrics.connectedClients}</strong><small>clients accepting payments</small></article>
        <article className={metrics.attentionClients.length ? "attention" : ""}><span>Needs attention</span><strong>{metrics.attentionClients.length}</strong><small>incomplete payment setup</small></article>
      </section>
      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-heading"><div><p className="eyebrow">PAYMENTS</p><h2>Onboarding attention</h2></div><Link href="/clients">View all clients</Link></div>
          {!overview && <p className="muted">Loading client health…</p>}
          {overview && metrics.attentionClients.length === 0 && <p className="empty-state">Every client has completed Stripe onboarding.</p>}
          <div className="attention-list">
            {metrics.attentionClients.map((organization) => (
              <Link key={organization.id} href={`/clients?organizationId=${encodeURIComponent(organization.id)}`}>
                <span><strong>{organization.name}</strong><small>{organization.locations.length} {organization.locations.length === 1 ? "location" : "locations"}</small></span>
                <span className="status warning">{statusLabel(organization.payments.onboardingStatus)}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="dashboard-panel">
          <div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Location readiness</h2></div></div>
          <div className="readiness-list">
            {(overview?.organizations ?? []).flatMap((organization) => organization.locations.map((location) => {
              const ready = location.active && location.configuration.branding && location.configuration.auditoriums > 0 && location.configuration.employees > 0;
              return (
                <Link key={location.id} href={`/clients?organizationId=${encodeURIComponent(organization.id)}`}>
                  <span><strong>{location.name}</strong><small>{organization.name}</small></span>
                  <span className={ready ? "status good" : "status warning"}>{ready ? "Operational" : "Setup needed"}</span>
                </Link>
              );
            }))}
          </div>
        </section>
      </div>
      {overview && <p className="dashboard-updated">Updated {new Date(overview.generatedAt).toLocaleString()}</p>}
    </main>
  );
}
