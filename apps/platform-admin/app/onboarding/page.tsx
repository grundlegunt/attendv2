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
  payments: { connected: boolean; onboardingStatus: string };
  locations: Array<{
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
  }>;
}

interface Overview {
  generatedAt: string;
  organizations: OrganizationOverview[];
}

interface OnboardingStep {
  label: string;
  complete: boolean;
}

function request<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }

function onboardingSteps(organization: OrganizationOverview): OnboardingStep[] {
  const operatingLocations = organization.locations.filter((location) => location.active);
  const locationsToPrepare = operatingLocations.length ? operatingLocations : organization.locations;
  return [
    { label: "Organization", complete: true },
    { label: "First location", complete: organization.locations.length > 0 },
    { label: "Stripe Connect", complete: organization.payments.onboardingStatus === "COMPLETE" },
    { label: "Branding", complete: locationsToPrepare.length > 0 && locationsToPrepare.every((location) => location.configuration.branding) },
    { label: "Staff access", complete: locationsToPrepare.length > 0 && locationsToPrepare.every((location) => location.configuration.employees > 0) },
    { label: "Ready to sell", complete: locationsToPrepare.length > 0 && locationsToPrepare.every((location) => location.configuration.auditoriums > 0 && location.configuration.upcomingShowtimes > 0) },
  ];
}

function nextAction(organization: OrganizationOverview, steps: OnboardingStep[]) {
  const next = steps.find((step) => !step.complete)?.label;
  if (next === "Stripe Connect") return { label: organization.payments.connected ? "Resume Stripe" : "Connect Stripe", href: "/payments" };
  if (next) return { label: `Complete ${next.toLowerCase()}`, href: `/clients?organizationId=${encodeURIComponent(organization.id)}` };
  return { label: "Review client", href: `/clients?organizationId=${encodeURIComponent(organization.id)}` };
}

export default function PlatformOnboarding() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const authRequestRef = useRef(0);

  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    request<Overview>("/platform/overview", undefined, session.accessToken)
      .then((nextOverview) => { if (active) setOverview(nextOverview); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load onboarding progress."); });
    return () => { active = false; };
  }, [session]);

  const pipeline = useMemo(() => (overview?.organizations ?? []).map((organization) => {
    const steps = onboardingSteps(organization);
    const completed = steps.filter((step) => step.complete).length;
    return { organization, steps, completed, action: nextAction(organization, steps) };
  }).sort((left, right) => left.completed - right.completed || left.organization.name.localeCompare(right.organization.name)), [overview]);

  const launched = pipeline.filter((item) => item.completed === item.steps.length).length;
  const inProgress = pipeline.length - launched;

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
    setSession(null);
    setOverview(null);
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
        <div><p className="eyebrow">ATTEND MASTER</p><h1>Onboarding</h1><p className="muted">Move every cinema client from account creation to selling tickets.</p></div>
        <div className="identity">{session.user.role !== "VIEWER" && <Link className="quiet link-button" href="/clients?create=1">+ Start client</Link>}<span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div>
      </header>
      <nav className="platform-nav" aria-label="Attend Master">
        <Link href="/">Dashboard</Link><Link href="/clients">Clients</Link><Link className="active" href="/onboarding">Onboarding</Link><Link href="/payments">Payments</Link><Link href="/content">Content</Link><Link href="/branding">Branding</Link>{session.user.role === "OWNER" && <Link href="/team">Team</Link>}<Link href="/audit">Audit Log</Link>
      </nav>
      {error && <div className="error">{error}</div>}
      <section className="onboarding-summary">
        <article><strong>{inProgress}</strong><span>In progress</span></article>
        <article><strong>{launched}</strong><span>Ready to sell</span></article>
        <article><strong>{pipeline.length}</strong><span>Total clients</span></article>
      </section>
      <section className="onboarding-pipeline">
        {!overview && <p className="muted">Loading onboarding pipeline…</p>}
        {overview && pipeline.length === 0 && <div className="client-empty-state"><h2>No clients yet</h2><p className="muted">Create the first cinema organization and location to begin.</p><Link className="link-button" href="/clients?create=1">Start first client</Link></div>}
        {pipeline.map(({ organization, steps, completed, action }) => (
          <article key={organization.id}>
            <div className="pipeline-heading">
              <div><p className="eyebrow">CLIENT ONBOARDING</p><h2>{organization.name}</h2><span className={completed === steps.length ? "status good" : "status warning"}>{completed} of {steps.length} complete</span></div>
              <Link className="link-button" href={action.href}>{action.label}</Link>
            </div>
            <div className="pipeline-progress" aria-label={`${organization.name} onboarding progress`}><span style={{ width: `${Math.round((completed / steps.length) * 100)}%` }} /></div>
            <ol className="pipeline-steps">
              {steps.map((step) => <li className={step.complete ? "complete" : ""} key={step.label}><i>{step.complete ? "✓" : ""}</i><span>{step.label}</span></li>)}
            </ol>
          </article>
        ))}
      </section>
      {overview && <p className="dashboard-updated">Updated {new Date(overview.generatedAt).toLocaleString()}</p>}
    </main>
  );
}
