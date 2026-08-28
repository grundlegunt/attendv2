"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { platformDownload, platformRequest, readPlatformSession, revokePlatformSession } from "./platform-session";
import { CompanySignIn } from "./company-sign-in";
import { PlatformNav } from "./platform-nav";

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
  health: { failedPayments24h: number; processingPayments: number; verificationReviews: number; failedRefunds: number; stalePayments: number; staleRefunds: number; managerReviewTabs: number; expiredHoldBacklog: number; lastSuccessfulPaymentAt: string | null; trends: { paymentFailure: { current: { failed: number; total: number; ratePercent: number | null }; previous: { failed: number; total: number; ratePercent: number | null } }; refunds: { current: { refundedCents: number; capturedCents: number; ratePercent: number | null }; previous: { refundedCents: number; capturedCents: number; ratePercent: number | null } } } };
  ticketFeeRemittances: Array<{ id: string; status: "DUE" | "PAID" | "VOID"; dueDate: string | null; nextFollowUpAt: string | null; platformShareCents: number; collectionOwner: { id: string } | null }>;
  locations: LocationOverview[];
}

interface Overview {
  generatedAt: string;
  deliveryReadiness: Record<"email" | "sms" | "appleWallet" | "googleWallet", { ready: boolean; provider: string }>;
  organizations: OrganizationOverview[];
}

interface RevenueTotals { ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; membershipRevenueCents: number; membershipPurchases: number; donationRevenueCents: number; donations: number; nonprofitRevenueCents: number; totalCollectedCents: number; refundedCents: number; ticketsSold: number; fnbOrders: number }
interface FilmRevenue { id: string; catalogEntryId: string | null; title: string; operators: number; locations: number; showtimes: number; ticketsSold: number; ticketRevenueCents: number }
interface RevenueReport { generatedAt: string; range: { from: string; to: string }; totals: RevenueTotals; clients: Array<{ id: string; name: string; locations: number } & RevenueTotals>; films: FilmRevenue[] }

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function lastActivity(value: string | null) { return value ? new Date(value).toLocaleString() : "No completed payments"; }
function rate(value: number | null) { return value === null ? "No activity" : `${value.toFixed(2)}%`; }
function remittanceAge(dueDate: string | null) {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / 86_400_000));
}
const revenueRanges = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 365, label: "Last year" },
] as const;

type RevenueRange = (typeof revenueRanges)[number]["days"] | "custom";

function dateInputValue(date: Date) { return date.toISOString().slice(0, 10); }

function revenueRange(range: RevenueRange, customFrom = "", customTo = "", format: "json" | "csv" = "json") {
  const path = `/platform/revenue${format === "csv" ? ".csv" : ""}`;
  if (range === "custom") {
    if (!customFrom || !customTo || customFrom > customTo) return null;
    return `${path}?from=${encodeURIComponent(`${customFrom}T00:00:00.000Z`)}&to=${encodeURIComponent(`${customTo}T23:59:59.999Z`)}`;
  }
  const to = new Date();
  const from = range === 1 ? new Date(to.getFullYear(), to.getMonth(), to.getDate()) : new Date(to.getTime() - range * 86_400_000);
  return `${path}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export default function PlatformDashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [revenueRangeKey, setRevenueRangeKey] = useState<RevenueRange>(7);
  const [customFrom, setCustomFrom] = useState(() => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 30); return dateInputValue(date); });
  const [customTo, setCustomTo] = useState(() => dateInputValue(new Date()));
  const [revenueLoading, setRevenueLoading] = useState(false);
  const overviewRequestRef = useRef(0);
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
    const overviewRequestId = ++overviewRequestRef.current;
    const revenueRequestId = ++revenueRequestRef.current;
    Promise.all([request<Overview>("/platform/overview", undefined, session.accessToken), request<RevenueReport>(revenueRange(7)!, undefined, session.accessToken)])
      .then(([nextOverview, nextRevenue]) => {
        if (!active) return;
        if (overviewRequestId === overviewRequestRef.current) setOverview(nextOverview);
        if (revenueRequestId === revenueRequestRef.current) setRevenue(nextRevenue);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load platform health."); });
    return () => {
      active = false;
      if (overviewRequestId === overviewRequestRef.current) overviewRequestRef.current += 1;
      if (revenueRequestId === revenueRequestRef.current) revenueRequestRef.current += 1;
    };
  }, [session]);

  async function loadRevenue(range: RevenueRange, from = customFrom, to = customTo) {
    if (!session) return;
    const path = revenueRange(range, from, to);
    setRevenueRangeKey(range);
    if (!path) return;
    const requestId = ++revenueRequestRef.current;
    setRevenueLoading(true); setError(null);
    try {
      const nextRevenue = await request<RevenueReport>(path, undefined, session.accessToken);
      if (requestId === revenueRequestRef.current) setRevenue(nextRevenue);
    }
    catch (reason) { if (requestId === revenueRequestRef.current) setError(reason instanceof Error ? reason.message : "Could not load platform revenue."); }
    finally { if (requestId === revenueRequestRef.current) setRevenueLoading(false); }
  }

  async function refreshOverview() {
    if (!session) return;
    const requestId = ++overviewRequestRef.current;
    setOverviewLoading(true); setError(null);
    try {
      const nextOverview = await request<Overview>("/platform/overview?refresh=true", undefined, session.accessToken);
      if (requestId === overviewRequestRef.current) setOverview(nextOverview);
    } catch (reason) {
      if (requestId === overviewRequestRef.current) setError(reason instanceof Error ? reason.message : "Could not refresh platform health.");
    } finally {
      if (requestId === overviewRequestRef.current) setOverviewLoading(false);
    }
  }

  async function downloadRevenue() {
    if (!session) return;
    const path = revenueRange(revenueRangeKey, customFrom, customTo, "csv");
    if (!path) return;
    setRevenueLoading(true); setError(null);
    try {
      const blob = await platformDownload(API_BASE_URL, STORAGE_KEY, path, session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `ringo-master-revenue-${revenueRangeKey === "custom" ? `${customFrom}-to-${customTo}` : `${revenueRangeKey}-day`}.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export platform revenue."); }
    finally { setRevenueLoading(false); }
  }

  const metrics = useMemo(() => {
    const organizations = overview?.organizations ?? [];
    const locations = organizations.flatMap((organization) => organization.locations);
    const urgentOperations = organizations.map((organization) => {
      const openRemittances = organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE");
      const urgentRemittances = openRemittances.filter((remittance) =>
        !remittance.collectionOwner ||
        Boolean(remittance.nextFollowUpAt && new Date(remittance.nextFollowUpAt) < new Date()) ||
        remittanceAge(remittance.dueDate) > 60,
      );
      const issueGroups = [
        openRemittances.some((remittance) => !remittance.collectionOwner),
        openRemittances.some((remittance) => remittance.nextFollowUpAt && new Date(remittance.nextFollowUpAt) < new Date()),
        openRemittances.some((remittance) => remittanceAge(remittance.dueDate) > 60),
      ].filter(Boolean).length;
      return {
        issueGroups,
        clientAffected: issueGroups > 0,
        remittanceCount: urgentRemittances.length,
        exposureCents: urgentRemittances.reduce((total, remittance) => total + remittance.platformShareCents, 0),
        unassignedCount: openRemittances.filter((remittance) => !remittance.collectionOwner).length,
        overdueFollowUpCount: openRemittances.filter((remittance) => remittance.nextFollowUpAt && new Date(remittance.nextFollowUpAt) < new Date()).length,
        criticalAgingCount: openRemittances.filter((remittance) => remittanceAge(remittance.dueDate) > 60).length,
      };
    });
    return {
      clients: organizations.length,
      locations: locations.length,
      activeLocations: locations.filter((location) => location.active).length,
      connectedClients: organizations.filter((organization) => organization.payments.onboardingStatus === "COMPLETE").length,
      attentionClients: organizations.filter((organization) => organization.payments.onboardingStatus !== "COMPLETE"),
      operationalExceptions: organizations.reduce((total, organization) => total + organization.health.failedPayments24h + organization.health.verificationReviews + organization.health.failedRefunds + organization.health.stalePayments + organization.health.staleRefunds + organization.health.managerReviewTabs + organization.health.expiredHoldBacklog, 0),
      urgentOperationGroups: urgentOperations.reduce((total, item) => total + item.issueGroups, 0),
      urgentOperationClients: urgentOperations.filter((item) => item.clientAffected).length,
      urgentRemittanceCount: urgentOperations.reduce((total, item) => total + item.remittanceCount, 0),
      urgentExposureCents: urgentOperations.reduce((total, item) => total + item.exposureCents, 0),
      urgentUnassignedCount: urgentOperations.reduce((total, item) => total + item.unassignedCount, 0),
      urgentOverdueFollowUpCount: urgentOperations.reduce((total, item) => total + item.overdueFollowUpCount, 0),
      urgentCriticalAgingCount: urgentOperations.reduce((total, item) => total + item.criticalAgingCount, 0),
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
    void revokePlatformSession(API_BASE_URL, session?.accessToken);
    window.sessionStorage.removeItem(STORAGE_KEY);
    overviewRequestRef.current += 1;
    revenueRequestRef.current += 1;
    setSession(null);
    setOverview(null);
    setRevenue(null);
    setError(null);
  }

  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) {
    return (
      <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />
    );
  }

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow platform-master-label" />
          <h1>Platform health</h1>
          <p className="muted">A cross-client view of onboarding and operating readiness.</p>
        </div>
        <div className="identity">
          {overview && <small>Updated {new Date(overview.generatedAt).toLocaleTimeString()}</small>}
          <Link className="diagnostics-link" href="/diagnostics">Diagnostics</Link>
          <button className="quiet" disabled={overviewLoading} onClick={() => void refreshOverview()}>{overviewLoading ? "Refreshing…" : "Refresh health"}</button>
          <span>{session.user.name}</span>
          <button className="quiet" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <PlatformNav role={session.user.role} />
      {error && <div className="error">{error}</div>}
      <section className="dashboard-summary" aria-label="Platform metrics">
        <article><span>Clients</span><strong>{metrics.clients}</strong><small>theater organizations</small></article>
        <article><span>Locations</span><strong>{metrics.locations}</strong><small>{metrics.activeLocations} active</small></article>
        <article><span>Stripe ready</span><strong>{metrics.connectedClients}</strong><small>clients accepting payments</small></article>
        <article className={metrics.operationalExceptions + metrics.attentionClients.length ? "attention" : ""}><span>Needs attention</span><strong>{metrics.operationalExceptions + metrics.attentionClients.length}</strong><small>open operational issue groups</small></article>
      </section>
      <section className={`dashboard-panel urgent-operations-panel ${metrics.urgentOperationGroups > 0 ? "has-urgent" : ""}`}>
        <div>
          <p className="eyebrow">URGENT OPERATIONS</p>
          <h2>{metrics.urgentOperationGroups > 0 ? `${metrics.urgentOperationGroups} issue groups need immediate follow-up` : "No urgent operational risks"}</h2>
          <p className="muted">{metrics.urgentOperationGroups > 0 ? `${metrics.urgentOperationClients} ${metrics.urgentOperationClients === 1 ? "client has" : "clients have"} ${metrics.urgentRemittanceCount} urgent ${metrics.urgentRemittanceCount === 1 ? "remittance" : "remittances"} representing ${money(metrics.urgentExposureCents)} in Ringo receivables.` : "No unassigned remittances, overdue follow-ups, or remittances more than 60 days past due."}</p>
          {metrics.urgentOperationGroups > 0 && <div className="urgent-operations-breakdown" aria-label="Urgent remittance causes"><Link href="/operations?priority=Urgent&risk=UNASSIGNED"><strong>{metrics.urgentUnassignedCount}</strong> unassigned</Link><Link href="/operations?priority=Urgent&risk=FOLLOW_UP_OVERDUE"><strong>{metrics.urgentOverdueFollowUpCount}</strong> overdue follow-ups</Link><Link href="/operations?priority=Urgent&risk=AGE_60_PLUS"><strong>{metrics.urgentCriticalAgingCount}</strong> over 60 days</Link></div>}
        </div>
        <Link href="/operations?priority=Urgent">Open urgent queue →</Link>
      </section>
      <section className="dashboard-panel delivery-readiness">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TICKET DELIVERY</p>
            <h2>Platform readiness</h2>
            <p className="muted">Deployment-level delivery services used by every cinema workspace.</p>
          </div>
          <Link href="/diagnostics">Open diagnostics</Link>
        </div>
        {!overview && <p className="muted">Loading ticket-delivery readiness…</p>}
        {overview && <div className="delivery-readiness-grid">
          {([
            ["email", "Email tickets"],
            ["sms", "SMS tickets"],
            ["appleWallet", "Apple Wallet"],
            ["googleWallet", "Google Wallet"],
          ] as const).map(([key, label]) => {
            const service = overview.deliveryReadiness[key];
            return <article key={key} className={service.ready ? "ready" : "not-ready"}>
              <span>{label}</span>
              <strong>{service.ready ? "Ready" : "Not configured"}</strong>
              <small>Provider: {statusLabel(service.provider)}</small>
            </article>;
          })}
        </div>}
      </section>
      <section className="dashboard-panel platform-revenue">
        <div className="panel-heading"><div><p className="eyebrow">REVENUE</p><h2>Cross-client activity</h2></div><div className="revenue-actions"><div className="range-toggle" aria-label="Revenue date range">{revenueRanges.map((range) => <button key={range.days} className={revenueRangeKey === range.days ? "active" : "quiet"} disabled={revenueLoading} onClick={() => void loadRevenue(range.days)}>{range.label}</button>)}<button className={revenueRangeKey === "custom" ? "active" : "quiet"} disabled={revenueLoading} onClick={() => void loadRevenue("custom")}>Custom</button></div><button className="quiet" disabled={revenueLoading || !revenue || (revenueRangeKey === "custom" && (!customFrom || !customTo))} onClick={() => void downloadRevenue()}>Export CSV</button></div></div>
        {revenueRangeKey === "custom" && <div className="custom-range film-custom-range"><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => { const value = event.target.value; setCustomFrom(value); void loadRevenue("custom", value, customTo); }} /></label><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => { const value = event.target.value; setCustomTo(value); void loadRevenue("custom", customFrom, value); }} /></label></div>}
        {!revenue && <p className="muted">Loading revenue rollup…</p>}
        {revenue && <><div className="revenue-breakdown"><article><span>Ticket face value</span><strong>{money(revenue.totals.ticketRevenueCents)}</strong></article><article><span>Ringo ticket-fee revenue</span><strong>{money(revenue.totals.ticketFeesCents)}</strong></article><article><span>Ticket tax</span><strong>{money(revenue.totals.ticketTaxCents)}</strong></article><article><span>Ticket total collected</span><strong>{money(revenue.totals.ticketCollectedCents)}</strong></article><article><span>F&amp;B revenue</span><strong>{money(revenue.totals.fnbRevenueCents)}</strong></article><article><span>Cinema net</span><strong>{money(revenue.totals.combinedRevenueCents)}</strong></article><article><span>Memberships</span><strong>{money(revenue.totals.membershipRevenueCents)}</strong><small>{revenue.totals.membershipPurchases.toLocaleString()} purchases</small></article><article><span>Donations</span><strong>{money(revenue.totals.donationRevenueCents)}</strong><small>{revenue.totals.donations.toLocaleString()} contributions</small></article><article><span>All collected</span><strong>{money(revenue.totals.totalCollectedCents)}</strong></article><article><span>Refunds</span><strong>{money(revenue.totals.refundedCents)}</strong></article></div><div className="client-revenue-list"><div><strong>Client</strong><span>Tickets sold</span><span>Cinema net</span><span>Memberships</span><span>Donations</span><span>All collected</span></div>{revenue.clients.map((client) => <Link key={client.id} href={`/clients?organizationId=${encodeURIComponent(client.id)}`}><strong>{client.name}</strong><span>{client.ticketsSold.toLocaleString()}</span><span>{money(client.combinedRevenueCents)}</span><span>{money(client.membershipRevenueCents)}</span><span>{money(client.donationRevenueCents)}</span><span>{money(client.totalCollectedCents)}</span></Link>)}</div><div className="film-revenue-heading"><div><p className="eyebrow">FILM PERFORMANCE</p><h3>Top films across cinemas</h3></div><small>Performance dates follow the selected revenue range.</small></div>{revenue.films.length === 0 ? <p className="empty-state">No ticketed film performances were recorded in this period.</p> : <div className="film-revenue-list"><div><strong>Film</strong><span>Operators</span><span>Locations</span><span>Shows</span><span>Tickets</span><span>Face value</span></div>{revenue.films.slice(0, 10).map((film) => film.catalogEntryId ? <Link key={film.id} href={`/films/${encodeURIComponent(film.catalogEntryId)}`}><strong>{film.title}</strong><span>{film.operators}</span><span>{film.locations}</span><span>{film.showtimes}</span><span>{film.ticketsSold.toLocaleString()}</span><span>{money(film.ticketRevenueCents)}</span></Link> : <div key={film.id} className="unlinked-film"><strong>{film.title}<small>Not linked to catalog</small></strong><span>{film.operators}</span><span>{film.locations}</span><span>{film.showtimes}</span><span>{film.ticketsSold.toLocaleString()}</span><span>{money(film.ticketRevenueCents)}</span></div>)}</div>}</>}
      </section>
      <section className="dashboard-panel operator-health">
        <div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Operator health</h2><p className="muted">Live payment and refund facts without speculative alert thresholds.</p></div><Link href="/operations">Open Operations Queue</Link></div>
        {!overview && <p className="muted">Loading operator health…</p>}
        {overview && <div className="operator-health-list">
          <div><strong>Client</strong><span>Last completed payment</span><span>Payment failure · 7d</span><span>Refund rate · 7d</span><span>Failed · 24h</span><span>Processing</span><span>Payment review</span><span>Failed refunds</span><span>Operational backlogs</span><span>Upcoming shows</span></div>
          {overview.organizations.map((organization) => {
            const upcomingShowtimes = organization.locations.reduce((total, location) => total + location.configuration.upcomingShowtimes, 0);
            const backlogTotal = organization.health.stalePayments + organization.health.staleRefunds + organization.health.managerReviewTabs + organization.health.expiredHoldBacklog;
            const hasException = organization.health.failedPayments24h + organization.health.verificationReviews + organization.health.failedRefunds + backlogTotal > 0;
            return <Link className={hasException ? "has-exception" : ""} key={organization.id} href={`/clients?organizationId=${encodeURIComponent(organization.id)}`}><strong>{organization.name}</strong><span>{lastActivity(organization.health.lastSuccessfulPaymentAt)}</span><span className="rate-summary"><strong>{rate(organization.health.trends.paymentFailure.current.ratePercent)}</strong><small>prior 7d: {rate(organization.health.trends.paymentFailure.previous.ratePercent)} · {organization.health.trends.paymentFailure.current.failed}/{organization.health.trends.paymentFailure.current.total} attempts</small></span><span className="rate-summary"><strong>{rate(organization.health.trends.refunds.current.ratePercent)}</strong><small>prior 7d: {rate(organization.health.trends.refunds.previous.ratePercent)} · {money(organization.health.trends.refunds.current.refundedCents)} refunded</small></span><span>{organization.health.failedPayments24h}</span><span>{organization.health.processingPayments}</span><span>{organization.health.verificationReviews}</span><span>{organization.health.failedRefunds}</span><span className="backlog-summary"><strong>{backlogTotal}</strong><small>{organization.health.stalePayments} payments · {organization.health.staleRefunds} refunds · {organization.health.managerReviewTabs} tabs · {organization.health.expiredHoldBacklog} holds</small></span><span>{upcomingShowtimes}</span></Link>;
          })}
        </div>}
        {overview && <p className="dashboard-updated">{metrics.operationalExceptions} unresolved or recent payment/refund exceptions across all clients.</p>}
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
