"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
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
    lastSuccessfulPaymentAt: string | null;
    trends: {
      paymentFailure: { current: { failed: number; total: number; ratePercent: number | null }; previous: { failed: number; total: number; ratePercent: number | null } };
      refunds: { current: { refundedCents: number; capturedCents: number; ratePercent: number | null }; previous: { refundedCents: number; capturedCents: number; ratePercent: number | null } };
    };
  };
  locations: Array<{ id: string; name: string; active: boolean }>;
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

export default function PlatformPayments() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [workingOrganizationId, setWorkingOrganizationId] = useState<string | null>(null);
  const [showExceptionsOnly, setShowExceptionsOnly] = useState(false);
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
    if (!showExceptionsOnly) return organizations;
    return organizations.filter((organization) => organization.health.failedPayments24h + organization.health.verificationReviews + organization.health.failedRefunds > 0);
  }, [overview, showExceptionsOnly]);

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

  if (!restored) return <main className="center"><p>Loading Attend Master…</p></main>;
  if (!session) {
    return (
      <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />
    );
  }

  return (
    <main className="shell">
      <header>
        <div><p className="eyebrow">ATTEND MASTER</p><h1>Payments</h1><p className="muted">Stripe Connect readiness across every cinema client.</p></div>
        <div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div>
      </header>
      <nav className="platform-nav" aria-label="Attend Master">
        <Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link href="/onboarding">Onboarding</Link><Link className="active" href="/payments">Payments</Link><Link href="/content">Content</Link><Link href="/branding">Branding</Link>{session.user.role === "OWNER" && <Link href="/team">Team</Link>}<Link href="/audit">Audit Log</Link>
      </nav>
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
      </section>
      <section className="payment-trend-summary" aria-label="Seven-day payment trends">
        <article><span>Payment failure · 7d</span><strong>{percentage(totals.failedAttempts7d, totals.paymentAttempts7d)}</strong><small>{totals.failedAttempts7d} failed of {totals.paymentAttempts7d} attempts · prior 7d {percentage(totals.previousFailedAttempts7d, totals.previousPaymentAttempts7d)}</small></article>
        <article><span>Refund rate · 7d</span><strong>{percentage(totals.refundedCents7d, totals.capturedCents7d)}</strong><small>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.refundedCents7d / 100)} refunded of {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totals.capturedCents7d / 100)} captured · prior 7d {percentage(totals.previousRefundedCents7d, totals.previousCapturedCents7d)}</small></article>
      </section>
      <div className="payments-toolbar"><div><p className="eyebrow">OPERATOR HEALTH</p><h2>Payment operations</h2></div><label><input type="checkbox" checked={showExceptionsOnly} onChange={(event) => setShowExceptionsOnly(event.target.checked)} /> Show exceptions only</label></div>
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
              <span className="payment-health"><strong>{organization.health.failedPayments24h} failed · 24h</strong><small>{organization.health.processingPayments} processing · {organization.health.verificationReviews} reviews · {organization.health.failedRefunds} failed refunds</small><small>7d failure: {organization.health.trends.paymentFailure.current.ratePercent === null ? "No activity" : `${organization.health.trends.paymentFailure.current.ratePercent.toFixed(2)}%`} · prior {organization.health.trends.paymentFailure.previous.ratePercent === null ? "No activity" : `${organization.health.trends.paymentFailure.previous.ratePercent.toFixed(2)}%`}</small><small>7d refunds: {organization.health.trends.refunds.current.ratePercent === null ? "No activity" : `${organization.health.trends.refunds.current.ratePercent.toFixed(2)}%`} · prior {organization.health.trends.refunds.previous.ratePercent === null ? "No activity" : `${organization.health.trends.refunds.previous.ratePercent.toFixed(2)}%`}</small><small>Last completed: {organization.health.lastSuccessfulPaymentAt ? new Date(organization.health.lastSuccessfulPaymentAt).toLocaleString() : "none"}</small></span>
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
