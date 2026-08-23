"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { platformDownload, platformRequest, readPlatformSession } from "./platform-session";
import { CompanySignIn } from "./company-sign-in";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";

interface Session {
  accessToken: string;
  user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" };
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

interface RevenueTotals { ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; refundedCents: number; ticketsSold: number; fnbOrders: number }
interface RevenueReport { generatedAt: string; range: { from: string; to: string }; totals: RevenueTotals; clients: Array<{ id: string; name: string; locations: number } & RevenueTotals> }

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
const revenueRanges = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 365, label: "Last year" },
] as const;

function revenueRange(days: number, format: "json" | "csv" = "json") { const to = new Date(); const from = days === 1 ? new Date(to.getFullYear(), to.getMonth(), to.getDate()) : new Date(to.getTime() - days * 86_400_000); return `/platform/revenue${format === "csv" ? ".csv" : ""}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`; }

export default function PlatformDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [revenueDays, setRevenueDays] = useState(7);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const revenueRequestRef = useRef(0);
  const authRequestRef = useRef(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const revenueRequestId = ++revenueRequestRef.current;
    Promise.all([request<Overview>("/platform/overview", undefined, session.accessToken), request<RevenueReport>(revenueRange(7), undefined, session.accessToken)])
      .then(([nextOverview, nextRevenue]) => {
        if (!active) return;
        setOverview(nextOverview);
        if (revenueRequestId === revenueRequestRef.current) setRevenue(nextRevenue);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load platform health."); });
    return () => {
      active = false;
      if (revenueRequestId === revenueRequestRef.current) revenueRequestRef.current += 1;
    };
  }, [session]);

  async function loadRevenue(days: number) {
    if (!session) return;
    const requestId = ++revenueRequestRef.current;
    setRevenueDays(days); setRevenueLoading(true); setError(null);
    try {
      const nextRevenue = await request<RevenueReport>(revenueRange(days), undefined, session.accessToken);
      if (requestId === revenueRequestRef.current) setRevenue(nextRevenue);
    }
    catch (reason) { if (requestId === revenueRequestRef.current) setError(reason instanceof Error ? reason.message : "Could not load platform revenue."); }
    finally { if (requestId === revenueRequestRef.current) setRevenueLoading(false); }
  }

  async function downloadRevenue() {
    if (!session) return;
    setRevenueLoading(true); setError(null);
    try {
      const blob = await platformDownload(API_BASE_URL, STORAGE_KEY, revenueRange(revenueDays, "csv"), session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `attend-master-revenue-${revenueDays}-day.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export platform revenue."); }
    finally { setRevenueLoading(false); }
  }

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
    const requestId = ++authRequestRef.current;
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (requestId !== authRequestRef.current) return;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) {
      if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed.");
    }
  }

  function signOut() {
    authRequestRef.current += 1;
    window.sessionStorage.removeItem(STORAGE_KEY);
    revenueRequestRef.current += 1;
    setSession(null);
    setOverview(null);
    setRevenue(null);
    setError(null);
  }

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) {
    return (
      <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />
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
        <Link href="/onboarding">Onboarding</Link>
        <Link href="/payments">Payments</Link>
        <Link href="/content">Content</Link>
        <Link href="/branding">Branding</Link>
        {session.user.role === "OWNER" && <Link href="/team">Team</Link>}
        <Link href="/audit">Audit Log</Link>
      </nav>
      {error && <div className="error">{error}</div>}
      <section className="dashboard-summary" aria-label="Platform metrics">
        <article><span>Clients</span><strong>{metrics.clients}</strong><small>theater organizations</small></article>
        <article><span>Locations</span><strong>{metrics.locations}</strong><small>{metrics.activeLocations} active</small></article>
        <article><span>Stripe ready</span><strong>{metrics.connectedClients}</strong><small>clients accepting payments</small></article>
        <article className={metrics.attentionClients.length ? "attention" : ""}><span>Needs attention</span><strong>{metrics.attentionClients.length}</strong><small>incomplete payment setup</small></article>
      </section>
      <section className="dashboard-panel platform-revenue">
        <div className="panel-heading"><div><p className="eyebrow">REVENUE</p><h2>Cross-client activity</h2></div><div className="revenue-actions"><div className="range-toggle" aria-label="Revenue date range">{revenueRanges.map((range) => <button key={range.days} className={revenueDays === range.days ? "active" : "quiet"} disabled={revenueLoading} onClick={() => void loadRevenue(range.days)}>{range.label}</button>)}</div><button className="quiet" disabled={revenueLoading || !revenue} onClick={() => void downloadRevenue()}>Export CSV</button></div></div>
        {!revenue && <p className="muted">Loading revenue rollup…</p>}
        {revenue && <><div className="revenue-breakdown"><article><span>Ticket face value</span><strong>{money(revenue.totals.ticketRevenueCents)}</strong></article><article><span>Attend ticket-fee revenue</span><strong>{money(revenue.totals.ticketFeesCents)}</strong></article><article><span>Ticket tax</span><strong>{money(revenue.totals.ticketTaxCents)}</strong></article><article><span>Ticket total collected</span><strong>{money(revenue.totals.ticketCollectedCents)}</strong></article><article><span>F&amp;B revenue</span><strong>{money(revenue.totals.fnbRevenueCents)}</strong></article><article><span>Combined net</span><strong>{money(revenue.totals.combinedRevenueCents)}</strong></article><article><span>Refunds</span><strong>{money(revenue.totals.refundedCents)}</strong></article></div><div className="client-revenue-list"><div><strong>Client</strong><span>Tickets sold</span><span>Ticket collected</span><span>F&amp;B</span><span>Combined net</span></div>{revenue.clients.map((client) => <Link key={client.id} href={`/clients?organizationId=${encodeURIComponent(client.id)}`}><strong>{client.name}</strong><span>{client.ticketsSold.toLocaleString()}</span><span>{money(client.ticketCollectedCents)}</span><span>{money(client.fnbRevenueCents)}</span><span>{money(client.combinedRevenueCents)}</span></Link>)}</div></>}
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
      {overview && <p className="dashboard-updated">Updated {new Date(revenue?.generatedAt ?? overview.generatedAt).toLocaleString()}</p>}
    </main>
  );
}
