"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

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

interface OrganizationOverview {
  id: string;
  name: string;
  legalName: string | null;
  payments: { connected: boolean; onboardingStatus: string };
  health: {
    failedPayments24h: number;
    processingPayments: number;
    verificationReviews: number;
    failedRefunds: number;
    stalePayments: number;
    staleRefunds: number;
    managerReviewTabs: number;
    expiredHoldBacklog: number;
    lastSuccessfulPaymentAt: string | null;
    trends: {
      paymentFailure: { current: { failed: number; total: number; ratePercent: number | null }; previous: { failed: number; total: number; ratePercent: number | null } };
      refunds: { current: { refundedCents: number; capturedCents: number; ratePercent: number | null }; previous: { refundedCents: number; capturedCents: number; ratePercent: number | null } };
    };
  };
  locations: Array<{ id: string; name: string; active: boolean }>;
  ticketFeeRemittances: Array<{
    id: string;
    periodFrom: string;
    periodTo: string;
    ticketCount: number;
    collectedFeeCents: number;
    platformShareCents: number;
    operatorShareCents: number;
    varianceCents: number;
    status: "DUE" | "PAID" | "VOID";
    dueDate: string | null;
    paidAt: string | null;
    paymentReference: string | null;
  }>;
}

interface Overview {
  generatedAt: string;
  organizations: OrganizationOverview[];
}

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : "No activity";
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function PlatformPayments() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [workingOrganizationId, setWorkingOrganizationId] = useState<string | null>(null);
  const [showExceptionsOnly, setShowExceptionsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [onboardingStatus, setOnboardingStatus] = useState("ALL");
  const overviewRequestRef = useRef(0);
  const authRequestRef = useRef(0);

  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);

  async function loadOverview(activeSession: Session) {
    const requestId = ++overviewRequestRef.current;
    try {
      const result = await request<Overview>("/platform/overview", undefined, activeSession.accessToken);
      if (requestId === overviewRequestRef.current) setOverview(result);
    } catch (reason) {
      if (requestId === overviewRequestRef.current) throw reason;
    }
  }

  useEffect(() => {
    if (!session) return;
    void loadOverview(session).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load payment readiness."));
    return () => { overviewRequestRef.current += 1; };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("exceptions") === "true") setShowExceptionsOnly(true);
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
      failedPayments24h: organizations.reduce((sum, organization) => sum + organization.health.failedPayments24h, 0),
      processingPayments: organizations.reduce((sum, organization) => sum + organization.health.processingPayments, 0),
      verificationReviews: organizations.reduce((sum, organization) => sum + organization.health.verificationReviews, 0),
      failedRefunds: organizations.reduce((sum, organization) => sum + organization.health.failedRefunds, 0),
      stalePayments: organizations.reduce((sum, organization) => sum + organization.health.stalePayments, 0),
      staleRefunds: organizations.reduce((sum, organization) => sum + organization.health.staleRefunds, 0),
      managerReviewTabs: organizations.reduce((sum, organization) => sum + organization.health.managerReviewTabs, 0),
      expiredHoldBacklog: organizations.reduce((sum, organization) => sum + organization.health.expiredHoldBacklog, 0),
      failedAttempts7d: organizations.reduce((sum, organization) => sum + organization.health.trends.paymentFailure.current.failed, 0),
      paymentAttempts7d: organizations.reduce((sum, organization) => sum + organization.health.trends.paymentFailure.current.total, 0),
      previousFailedAttempts7d: organizations.reduce((sum, organization) => sum + organization.health.trends.paymentFailure.previous.failed, 0),
      previousPaymentAttempts7d: organizations.reduce((sum, organization) => sum + organization.health.trends.paymentFailure.previous.total, 0),
      refundedCents7d: organizations.reduce((sum, organization) => sum + organization.health.trends.refunds.current.refundedCents, 0),
      capturedCents7d: organizations.reduce((sum, organization) => sum + organization.health.trends.refunds.current.capturedCents, 0),
      previousRefundedCents7d: organizations.reduce((sum, organization) => sum + organization.health.trends.refunds.previous.refundedCents, 0),
      previousCapturedCents7d: organizations.reduce((sum, organization) => sum + organization.health.trends.refunds.previous.capturedCents, 0),
    };
  }, [overview]);

  const displayedOrganizations = useMemo(() => {
    const organizations = overview?.organizations ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    return organizations.filter((organization) => {
      if (normalizedQuery && !`${organization.name} ${organization.legalName ?? ""}`.toLowerCase().includes(normalizedQuery)) return false;
      if (onboardingStatus !== "ALL" && organization.payments.onboardingStatus !== onboardingStatus) return false;
      const openRemittances = organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE").length;
      if (showExceptionsOnly && organization.health.failedPayments24h + organization.health.verificationReviews + organization.health.failedRefunds + organization.health.stalePayments + organization.health.staleRefunds + organization.health.managerReviewTabs + organization.health.expiredHoldBacklog + openRemittances === 0) return false;
      return true;
    });
  }, [onboardingStatus, overview, query, showExceptionsOnly]);

  const remittanceLedger = useMemo(() => (overview?.organizations ?? []).flatMap((organization) => organization.ticketFeeRemittances.map((remittance) => ({ ...remittance, organizationId: organization.id, organizationName: organization.name }))).sort((left, right) => new Date(right.periodFrom).getTime() - new Date(left.periodFrom).getTime()), [overview]);
  const remittanceTotals = useMemo(() => {
    const due = remittanceLedger.filter((item) => item.status === "DUE");
    const paid = remittanceLedger.filter((item) => item.status === "PAID");
    const now = new Date();
    return {
      dueCents: due.reduce((sum, item) => sum + item.platformShareCents, 0),
      dueCount: due.length,
      overdueCount: due.filter((item) => item.dueDate && new Date(item.dueDate) < now).length,
      paidCents: paid.reduce((sum, item) => sum + item.platformShareCents, 0),
      paidCount: paid.length,
    };
  }, [remittanceLedger]);

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

  function exportPaymentOperations() {
    const columns = ["Client", "Legal name", "Locations", "Stripe status", "Open fee remittances", "Overdue fee remittances", "Ringo receivable due", "Ringo remittances paid", "Failed payments 24h", "Processing payments", "Payment reviews", "Failed refunds", "Stale payments", "Stale refunds", "Manager-review tabs", "Expired seat holds", "Payment failure rate 7d", "Payment failure rate prior 7d", "Refund rate 7d", "Refund rate prior 7d", "Last successful payment"];
    const rows = displayedOrganizations.map((organization) => [
      organization.name,
      organization.legalName,
      organization.locations.length,
      organization.payments.onboardingStatus,
      organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE").length,
      organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE" && remittance.dueDate && new Date(remittance.dueDate) < new Date()).length,
      organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE").reduce((sum, remittance) => sum + remittance.platformShareCents, 0) / 100,
      organization.ticketFeeRemittances.filter((remittance) => remittance.status === "PAID").reduce((sum, remittance) => sum + remittance.platformShareCents, 0) / 100,
      organization.health.failedPayments24h,
      organization.health.processingPayments,
      organization.health.verificationReviews,
      organization.health.failedRefunds,
      organization.health.stalePayments,
      organization.health.staleRefunds,
      organization.health.managerReviewTabs,
      organization.health.expiredHoldBacklog,
      organization.health.trends.paymentFailure.current.ratePercent,
      organization.health.trends.paymentFailure.previous.ratePercent,
      organization.health.trends.refunds.current.ratePercent,
      organization.health.trends.refunds.previous.ratePercent,
      organization.health.lastSuccessfulPaymentAt,
    ]);
    const blob = new Blob([[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ringo-master-payment-operations-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
        <div><p className="eyebrow platform-master-label" /><h1>Payments</h1><p className="muted">Stripe Connect readiness across every cinema client.</p></div>
        <div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div>
      </header>
      <PlatformNav role={session.user.role} />
      {error && <div className="error">{error}</div>}
      <section className="payment-summary" aria-label="Stripe onboarding totals">
        <article><strong>{totals.complete}</strong><span>Complete</span></article>
        <article><strong>{totals.inProgress}</strong><span>In progress</span></article>
        <article><strong>{totals.notStarted}</strong><span>Not started</span></article>
      </section>
      <section className="payment-summary payment-health-summary" aria-label="Payment operations totals">
        <article><strong>{totals.failedPayments24h}</strong><span>Failed payments · 24h</span></article>
        <article><strong>{totals.processingPayments}</strong><span>Processing now</span></article>
        <article><strong>{totals.verificationReviews}</strong><span>Payment reviews</span></article>
        <article><strong>{totals.failedRefunds}</strong><span>Failed refunds</span></article>
        <article><strong>{totals.stalePayments}</strong><span>Stale payments</span></article>
        <article><strong>{totals.staleRefunds}</strong><span>Stale refunds</span></article>
        <article><strong>{totals.managerReviewTabs}</strong><span>Manager-review tabs</span></article>
        <article><strong>{totals.expiredHoldBacklog}</strong><span>Expired seat holds</span></article>
      </section>
      <section className="payment-trend-summary" aria-label="Seven-day payment trends">
        <article><span>Payment failure · 7d</span><strong>{percentage(totals.failedAttempts7d, totals.paymentAttempts7d)}</strong><small>{totals.failedAttempts7d} failed of {totals.paymentAttempts7d} attempts · prior 7d {percentage(totals.previousFailedAttempts7d, totals.previousPaymentAttempts7d)}</small></article>
        <article><span>Refund rate · 7d</span><strong>{percentage(totals.refundedCents7d, totals.capturedCents7d)}</strong><small>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.refundedCents7d / 100)} refunded of {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.capturedCents7d / 100)} captured · prior 7d {percentage(totals.previousRefundedCents7d, totals.previousCapturedCents7d)}</small></article>
      </section>
      <div className="payments-toolbar"><div><p className="eyebrow">TICKET-FEE RECEIVABLES</p><h2>Operator remittances</h2></div><div className="payments-toolbar-actions"><span>{remittanceLedger.length} finalized periods</span></div></div>
      <section className="payment-summary remittance-summary" aria-label="Ticket fee remittance totals">
        <article><strong>{money(remittanceTotals.dueCents)}</strong><span>Ringo share due</span><small>{remittanceTotals.dueCount} open periods</small></article>
        <article><strong>{remittanceTotals.overdueCount}</strong><span>Overdue periods</span><small>Past their assigned due date</small></article>
        <article><strong>{money(remittanceTotals.paidCents)}</strong><span>Ringo share paid</span><small>{remittanceTotals.paidCount} periods received</small></article>
      </section>
      <section className="remittance-master-table">
        <div><span>Operator</span><span>Period</span><span>Tickets</span><span>Ringo receivable</span><span>Status</span><span>Action</span></div>
        {!overview && <p className="muted payments-loading">Loading operator remittances…</p>}
        {overview && remittanceLedger.length === 0 && <p className="empty-state payments-loading">No ticket-fee settlement periods have been finalized yet.</p>}
        {remittanceLedger.map((remittance) => <article key={remittance.id}><strong>{remittance.organizationName}</strong><span>{new Date(remittance.periodFrom).toLocaleDateString()} – {new Date(remittance.periodTo).toLocaleDateString()}</span><span>{remittance.ticketCount.toLocaleString()}</span><span><strong>{money(remittance.platformShareCents)}</strong><small>{money(remittance.collectedFeeCents)} collected</small></span><span><b className={`status ${remittance.status === "PAID" ? "good" : remittance.status === "DUE" && remittance.dueDate && new Date(remittance.dueDate) < new Date() ? "warning" : ""}`}>{remittance.status.toLowerCase()}</b><small>{remittance.status === "PAID" && remittance.paidAt ? new Date(remittance.paidAt).toLocaleDateString() : remittance.dueDate ? `Due ${new Date(remittance.dueDate).toLocaleDateString()}` : "No due date"}</small></span><Link href={`/clients?organizationId=${encodeURIComponent(remittance.organizationId)}`}>Open client →</Link></article>)}
      </section>
      <div className="payments-toolbar"><div><p className="eyebrow">OPERATOR HEALTH</p><h2>Payment operations</h2></div><div className="payments-toolbar-actions"><span>{displayedOrganizations.length} of {overview?.organizations.length ?? 0} clients</span><button className="quiet" type="button" disabled={!overview || displayedOrganizations.length === 0} onClick={exportPaymentOperations}>Export CSV</button></div></div>
      <section className="payments-filters" aria-label="Filter payment operations">
        <label>Find client<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cinema or legal name" /></label>
        <label>Stripe status<select value={onboardingStatus} onChange={(event) => setOnboardingStatus(event.target.value)}><option value="ALL">All statuses</option><option value="COMPLETE">Complete</option><option value="IN_PROGRESS">In progress</option><option value="NOT_STARTED">Not started</option></select></label>
        <label className="payments-exception-filter"><input type="checkbox" checked={showExceptionsOnly} onChange={(event) => setShowExceptionsOnly(event.target.checked)} /> Show exceptions only</label>
        <button className="quiet" type="button" disabled={!query && onboardingStatus === "ALL" && !showExceptionsOnly} onClick={() => { setQuery(""); setOnboardingStatus("ALL"); setShowExceptionsOnly(false); }}>Clear filters</button>
      </section>
      <section className="payments-table">
        <div className="payments-table-heading"><span>Client</span><span>Locations</span><span>Stripe status</span><span>Operational status</span><span>Action</span></div>
        {!overview && <p className="muted payments-loading">Loading payment readiness…</p>}
        {overview && displayedOrganizations.length === 0 && <p className="empty-state payments-loading">No clients match this view.</p>}
        {displayedOrganizations.map((organization) => {
          const complete = organization.payments.onboardingStatus === "COMPLETE";
          const working = workingOrganizationId === organization.id;
          return (
            <article key={organization.id}>
              <span><strong>{organization.name}</strong><small>{organization.legalName ?? "Legal name not configured"}</small></span>
              <span>{organization.locations.length}</span>
              <span className={complete ? "status good" : "status warning"}>{statusLabel(organization.payments.onboardingStatus)}</span>
              <span className="payment-health"><strong>{organization.health.failedPayments24h} failed · 24h</strong><small>{organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE").length} open fee remittances · {money(organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE").reduce((sum, remittance) => sum + remittance.platformShareCents, 0))} due</small><small>{organization.health.processingPayments} processing · {organization.health.verificationReviews} reviews · {organization.health.failedRefunds} failed refunds</small><small>{organization.health.stalePayments} stale payments · {organization.health.staleRefunds} stale refunds</small><small>{organization.health.managerReviewTabs} manager-review tabs · {organization.health.expiredHoldBacklog} expired holds</small><small>7d failure: {organization.health.trends.paymentFailure.current.ratePercent === null ? "No activity" : `${organization.health.trends.paymentFailure.current.ratePercent.toFixed(2)}%`} · prior {organization.health.trends.paymentFailure.previous.ratePercent === null ? "No activity" : `${organization.health.trends.paymentFailure.previous.ratePercent.toFixed(2)}%`}</small><small>7d refunds: {organization.health.trends.refunds.current.ratePercent === null ? "No activity" : `${organization.health.trends.refunds.current.ratePercent.toFixed(2)}%`} · prior {organization.health.trends.refunds.previous.ratePercent === null ? "No activity" : `${organization.health.trends.refunds.previous.ratePercent.toFixed(2)}%`}</small><small>Last completed: {organization.health.lastSuccessfulPaymentAt ? new Date(organization.health.lastSuccessfulPaymentAt).toLocaleString() : "none"}</small></span>
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
