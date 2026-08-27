"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformDownload, platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
type Session = { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } };
type Counts = Record<"Pageview" | "Seat Selection Continued" | "Checkout Started" | "Payment Form Ready" | "Checkout Completed" | "Account Created" | "Gift Card Started" | "Gift Card Purchased" | "Membership Checkout Started" | "Membership Activated" | "Donation Checkout Started" | "Donation Completed" | "Private Event Inquiry Submitted" | "Waitlist Joined", number>;
type Rates = { seatToCheckoutRatePercent: number | null; paymentFormReadyRatePercent: number | null; paymentCompletionRatePercent: number | null; checkoutCompletionRatePercent: number | null; giftCardCompletionRatePercent: number | null; membershipCompletionRatePercent: number | null; donationCompletionRatePercent: number | null };
type Report = {
  generatedAt: string;
  range: { from: string; to: string };
  clients: Array<{ id: string; name: string }>;
  totals: Counts & Rates;
  daily: Array<{ date: string } & Counts>;
  pages: Array<{ path: string; count: number }>;
  locations: Array<{ organization: { id: string; name: string }; location: { id: string; name: string } } & Counts & Rates>;
};

const request = <T,>(path: string, init?: RequestInit, token?: string) => platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, token);
const dateInput = (date: Date) => date.toISOString().slice(0, 10);
const rate = (value: number | null) => value === null ? "No starts" : `${value.toFixed(2)}%`;

export default function AudienceAnalyticsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [organizationId, setOrganizationId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  async function load(current: Session, nextFrom = from, nextTo = to, nextOrganizationId = organizationId) {
    const id = ++requestRef.current; setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo });
      if (nextOrganizationId) params.set("organizationId", nextOrganizationId);
      const result = await request<Report>(`/platform/audience-analytics?${params}`, undefined, current.accessToken);
      if (id === requestRef.current) setReport(result);
    } catch (reason) { if (id === requestRef.current) setError(reason instanceof Error ? reason.message : "Could not load audience analytics."); }
    finally { if (id === requestRef.current) setLoading(false); }
  }
  async function download() {
    if (!session || !report || !from || !to || from > to) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (organizationId) params.set("organizationId", organizationId);
      const blob = await platformDownload(API_BASE_URL, STORAGE_KEY, `/platform/audience-analytics.csv?${params}`, session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `ringo-master-audience-${from}-to-${to}.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export audience analytics."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (session) void load(session); return () => { requestRef.current += 1; }; }, [session]);
  async function login(event: FormEvent) { event.preventDefault(); setError(null); try { const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  function signOut() { requestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setReport(null); }
  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;
  const organizations = report?.clients ?? [];
  const maxDailyActivity = Math.max(1, ...(report?.daily ?? []).map((day) => day.Pageview + day["Checkout Started"] + day["Checkout Completed"]));
  return <main className="shell">
    <header><div><p className="eyebrow platform-master-label" /><h1>Audience</h1><p className="muted">Privacy-safe customer-site engagement across cinema operators.</p></div><div className="identity"><span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header>
    <PlatformNav role={session.user.role} />
    {error && <div className="error">{error}</div>}
    <section className="dashboard-panel audience-explainer"><strong>Consented interactions, not unique visitors</strong><span>Only customers who allow optional analytics are counted. Ringo stores daily totals—not identities, devices, IP addresses, orders, or tickets.</span></section>
    <form className="analytics-filters" onSubmit={(event) => { event.preventDefault(); void load(session); }}><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><label>Client<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}><option value="">All clients</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><button disabled={loading || !from || !to || from > to}>{loading ? "Loading…" : "Apply"}</button><button type="button" className="quiet" disabled={loading || !report || !from || !to || from > to} onClick={() => void download()}>Export CSV</button></form>
    {!report && !loading && <p className="muted">No audience activity loaded.</p>}
    {report && <>
      <section className="dashboard-summary audience-summary"><article><span>Pageviews</span><strong>{report.totals.Pageview.toLocaleString()}</strong><small>consented views</small></article><article><span>Checkout completion</span><strong>{rate(report.totals.checkoutCompletionRatePercent)}</strong><small>{report.totals["Checkout Completed"]} completed / {report.totals["Checkout Started"]} started</small></article><article><span>Accounts created</span><strong>{report.totals["Account Created"].toLocaleString()}</strong><small>consented events</small></article><article><span>Waitlist joins</span><strong>{report.totals["Waitlist Joined"].toLocaleString()}</strong><small>consented events</small></article></section>
      <section className="analytics-funnels checkout-funnel"><article><h2>Seats continued</h2><strong>{report.totals["Seat Selection Continued"]}</strong><span>customers continued from seat selection</span></article><article><h2>Checkout created</h2><strong>{report.totals["Checkout Started"]}</strong><span>{rate(report.totals.seatToCheckoutRatePercent)} from seat selection</span></article><article><h2>Payment ready</h2><strong>{report.totals["Payment Form Ready"]}</strong><span>{rate(report.totals.paymentFormReadyRatePercent)} from checkout creation</span></article><article><h2>Completed</h2><strong>{report.totals["Checkout Completed"]}</strong><span>{rate(report.totals.paymentCompletionRatePercent)} from payment form</span></article></section>
      <section className="analytics-funnels"><article><h2>Gift cards</h2><strong>{report.totals["Gift Card Purchased"]}</strong><span>purchases · {rate(report.totals.giftCardCompletionRatePercent)} completion</span></article><article><h2>Memberships</h2><strong>{report.totals["Membership Activated"]}</strong><span>activations · {rate(report.totals.membershipCompletionRatePercent)} completion</span></article><article><h2>Donations</h2><strong>{report.totals["Donation Completed"]}</strong><span>completed · {rate(report.totals.donationCompletionRatePercent)} completion</span></article><article><h2>Private events</h2><strong>{report.totals["Private Event Inquiry Submitted"]}</strong><span>inquiries submitted</span></article></section>
      <section className="dashboard-panel analytics-trend"><div className="panel-heading"><div><p className="eyebrow">TREND</p><h2>Daily customer activity</h2><p className="muted">Pageviews and checkout interactions reported by consenting customers.</p></div></div><div className="analytics-trend-list">{report.daily.length === 0 && <p className="empty-state">No consented activity in this range.</p>}{report.daily.map((day) => { const activity = day.Pageview + day["Checkout Started"] + day["Checkout Completed"]; return <div key={day.date}><time dateTime={day.date}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time><span className="analytics-trend-bar"><i style={{ width: `${activity / maxDailyActivity * 100}%` }} /></span><strong>{day.Pageview}<small>views</small></strong><strong>{day["Checkout Started"]}<small>starts</small></strong><strong>{day["Checkout Completed"]}<small>sales</small></strong></div>; })}</div></section>
      <div className="dashboard-grid analytics-grid"><section className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">CLIENTS</p><h2>Engagement by location</h2></div></div><div className="analytics-location-list"><div><strong>Client / location</strong><span>Views</span><span>Checkout</span><span>Members</span><span>Donations</span><span>Gift cards</span></div>{report.locations.map((row) => <Link key={row.location.id} href={`/clients?organizationId=${encodeURIComponent(row.organization.id)}&locationId=${encodeURIComponent(row.location.id)}`}><strong>{row.organization.name}<small>{row.location.name}</small></strong><span>{row.Pageview}</span><span>{rate(row.checkoutCompletionRatePercent)}</span><span>{row["Membership Activated"]}</span><span>{row["Donation Completed"]}</span><span>{row["Gift Card Purchased"]}</span></Link>)}</div></section><section className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">CONTENT</p><h2>Top pages</h2></div></div><div className="analytics-page-list">{report.pages.length === 0 && <p className="empty-state">No consented pageviews in this range.</p>}{report.pages.map((page) => <div key={page.path}><code>{page.path}</code><strong>{page.count.toLocaleString()}</strong></div>)}</div></section></div>
      <p className="dashboard-updated">Cinema-local daily buckets · {report.range.from} through {report.range.to} · updated {new Date(report.generatedAt).toLocaleString()}</p>
    </>}
  </main>;
}
