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

interface OrganizationOverview {
  id: string;
  name: string;
  legalName: string | null;
  payments: { connected: boolean; onboardingStatus: string };
  locations: Array<{ id: string; name: string; active: boolean }>;
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

export default function PlatformPayments() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [workingOrganizationId, setWorkingOrganizationId] = useState<string | null>(null);

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

  async function loadOverview(activeSession: Session) {
    const result = await request<Overview>("/platform/overview", undefined, activeSession.accessToken);
    setOverview(result);
  }

  useEffect(() => {
    if (!session) return;
    void loadOverview(session).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load payment readiness."));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    const organizationId = params.get("organizationId");
    const connectAction = params.get("connect");
    if (!organizationId || !connectAction) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (connectAction === "refresh") void startConnectOnboarding(organizationId);
    if (connectAction === "return") void refreshConnectStatus(organizationId);
  }, [session]);

  const totals = useMemo(() => {
    const organizations = overview?.organizations ?? [];
    return {
      complete: organizations.filter((organization) => organization.payments.onboardingStatus === "COMPLETE").length,
      inProgress: organizations.filter((organization) => organization.payments.onboardingStatus === "IN_PROGRESS").length,
      notStarted: organizations.filter((organization) => organization.payments.onboardingStatus === "NOT_STARTED").length,
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

  async function startConnectOnboarding(organizationId: string) {
    if (!session) return;
    setWorkingOrganizationId(organizationId);
    setError(null);
    try {
      const result = await request<{ url: string }>(
        `/platform/organizations/${organizationId}/connect/onboarding-link`,
        { method: "POST", body: JSON.stringify({ origin: window.location.origin, returnPath: "/payments" }) },
        session.accessToken,
      );
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start Stripe onboarding.");
      setWorkingOrganizationId(null);
    }
  }

  async function refreshConnectStatus(organizationId: string) {
    if (!session) return;
    setWorkingOrganizationId(organizationId);
    setError(null);
    try {
      await request(`/platform/organizations/${organizationId}/connect/refresh`, { method: "POST" }, session.accessToken);
      await loadOverview(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh Stripe onboarding status.");
    } finally {
      setWorkingOrganizationId(null);
    }
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
        <div><p className="eyebrow">ATTEND MASTER</p><h1>Payments</h1><p className="muted">Stripe Connect readiness across every cinema client.</p></div>
        <div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div>
      </header>
      <nav className="platform-nav" aria-label="Attend Master">
        <Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link href="/onboarding">Onboarding</Link><Link className="active" href="/payments">Payments</Link>
      </nav>
      {error && <div className="error">{error}</div>}
      <section className="payment-summary" aria-label="Stripe onboarding totals">
        <article><strong>{totals.complete}</strong><span>Complete</span></article>
        <article><strong>{totals.inProgress}</strong><span>In progress</span></article>
        <article><strong>{totals.notStarted}</strong><span>Not started</span></article>
      </section>
      <section className="payments-table">
        <div className="payments-table-heading"><span>Client</span><span>Locations</span><span>Stripe status</span><span>Action</span></div>
        {!overview && <p className="muted payments-loading">Loading payment readiness…</p>}
        {overview?.organizations.map((organization) => {
          const complete = organization.payments.onboardingStatus === "COMPLETE";
          const working = workingOrganizationId === organization.id;
          return (
            <article key={organization.id}>
              <span><strong>{organization.name}</strong><small>{organization.legalName ?? "Legal name not configured"}</small></span>
              <span>{organization.locations.length}</span>
              <span className={complete ? "status good" : "status warning"}>{statusLabel(organization.payments.onboardingStatus)}</span>
              <span className="payment-actions">
                {!complete && <button disabled={working} onClick={() => void startConnectOnboarding(organization.id)}>{working ? "Opening…" : organization.payments.connected ? "Resume onboarding" : "Connect Stripe"}</button>}
                {organization.payments.connected && <button className="quiet" disabled={working} onClick={() => void refreshConnectStatus(organization.id)}>Refresh</button>}
                <Link href={`/clients?organizationId=${encodeURIComponent(organization.id)}`}>Client profile</Link>
              </span>
            </article>
          );
        })}
      </section>
      {overview && <p className="dashboard-updated">Updated {new Date(overview.generatedAt).toLocaleString()}</p>}
    </main>
  );
}
