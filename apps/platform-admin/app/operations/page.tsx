"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
interface Session { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } }
interface Location { id: string; name: string; active: boolean; configuration: { branding: boolean; auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number } }
interface Organization { id: string; name: string; payments: { onboardingStatus: string }; health: { failedPayments24h: number; verificationReviews: number; failedRefunds: number; stalePayments: number; staleRefunds: number; managerReviewTabs: number; expiredHoldBacklog: number }; ticketFeeRemittances: Array<{ status: "DUE" | "PAID" | "VOID"; dueDate: string | null; platformShareCents: number }>; locations: Location[] }
interface Overview { generatedAt: string; organizations: Organization[] }
type QueueItem = { id: string; client: string; location: string | null; category: "Payments" | "Refunds" | "Ticketing" | "Setup"; issue: string; count: number; href: string; priority: number };

function request<T>(path: string, init?: RequestInit, accessToken?: string) { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }
function label(value: string) { return value.toLowerCase().replaceAll("_", " "); }

function queueItems(organizations: Organization[]): QueueItem[] {
  return organizations.flatMap((organization) => {
    const clientHref = `/clients?organizationId=${encodeURIComponent(organization.id)}`;
    const paymentHref = `/payments?organizationId=${encodeURIComponent(organization.id)}&exceptions=true`;
    const rows: QueueItem[] = [];
    const add = (category: QueueItem["category"], issue: string, count: number, href: string, priority: number) => { if (count > 0) rows.push({ id: `${organization.id}-${category}-${issue}`, client: organization.name, location: null, category, issue, count, href, priority }); };
    if (organization.payments.onboardingStatus !== "COMPLETE") add("Payments", `Stripe setup ${label(organization.payments.onboardingStatus)}`, 1, paymentHref, 90);
    add("Payments", "Failed payments in the last 24 hours", organization.health.failedPayments24h, paymentHref, 100);
    add("Payments", "Payments awaiting verification", organization.health.verificationReviews, paymentHref, 95);
    add("Payments", "Stale processing payments", organization.health.stalePayments, paymentHref, 85);
    const openRemittances = organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE");
    const overdueRemittances = openRemittances.filter((remittance) => remittance.dueDate && new Date(remittance.dueDate) < new Date());
    add("Payments", "Overdue ticket-fee remittances", overdueRemittances.length, clientHref, 105);
    add("Payments", "Open ticket-fee remittances", openRemittances.length - overdueRemittances.length, clientHref, 82);
    add("Refunds", "Failed refunds", organization.health.failedRefunds, paymentHref, 100);
    add("Refunds", "Stale refunds", organization.health.staleRefunds, paymentHref, 85);
    add("Ticketing", "Tabs awaiting manager review", organization.health.managerReviewTabs, paymentHref, 80);
    add("Ticketing", "Expired seat holds awaiting cleanup", organization.health.expiredHoldBacklog, paymentHref, 75);
    for (const location of organization.locations) {
      const missing = [!location.configuration.branding && "branding", location.configuration.auditoriums === 0 && "auditoriums", location.configuration.employees === 0 && "staff"].filter(Boolean) as string[];
      if (!location.active || missing.length === 0) continue;
      rows.push({ id: `${organization.id}-${location.id}-setup`, client: organization.name, location: location.name, category: "Setup", issue: `Missing ${missing.join(", ")}`, count: missing.length, href: `${clientHref}&locationId=${encodeURIComponent(location.id)}`, priority: 70 });
    }
    return rows;
  }).sort((left, right) => right.priority - left.priority || right.count - left.count || left.client.localeCompare(right.client));
}

export default function OperationsQueue() {
  const [session, setSession] = useState<Session | null>(null); const [restored, setRestored] = useState(false); const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [query, setQuery] = useState(""); const [category, setCategory] = useState("ALL");
  const authRequestRef = useRef(0);
  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  useEffect(() => { if (!session) return; let active = true; request<Overview>("/platform/overview", undefined, session.accessToken).then((result) => { if (active) setOverview(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the operations queue."); }); return () => { active = false; }; }, [session]);
  const allItems = useMemo(() => queueItems(overview?.organizations ?? []), [overview]);
  const items = useMemo(() => allItems.filter((item) => (category === "ALL" || item.category === category) && `${item.client} ${item.location ?? ""} ${item.issue}`.toLowerCase().includes(query.trim().toLowerCase())), [allItems, category, query]);
  const affectedClients = new Set(items.map((item) => item.client)).size;
  async function login(event: FormEvent) { event.preventDefault(); const requestId = ++authRequestRef.current; setError(null); try { const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); if (requestId !== authRequestRef.current) return; window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  function signOut() { authRequestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOverview(null); setError(null); }
  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;
  return <main className="shell"><header><div><p className="eyebrow platform-master-label" /><h1>Operations Queue</h1><p className="muted">One prioritized list of operator issues that require Ringo or cinema follow-up.</p></div><div className="identity">{overview && <small>Updated {new Date(overview.generatedAt).toLocaleTimeString()}</small>}<span>{session.user.name}</span><button className="quiet" onClick={signOut}>Sign out</button></div></header><PlatformNav role={session.user.role} />{error && <div className="error">{error}</div>}<section className="operations-summary"><article><span>Open issue groups</span><strong>{allItems.length}</strong></article><article><span>Shown</span><strong>{items.length}</strong></article><article><span>Affected clients</span><strong>{affectedClients}</strong></article></section><section className="operations-toolbar"><label>Search queue<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, location, or issue" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">All categories</option><option value="Payments">Payments</option><option value="Refunds">Refunds</option><option value="Ticketing">Ticketing</option><option value="Setup">Setup</option></select></label><button className="quiet" disabled={!query && category === "ALL"} onClick={() => { setQuery(""); setCategory("ALL"); }}>Clear filters</button></section>{!overview && <p className="muted">Loading operator exceptions…</p>}{overview && items.length === 0 && <p className="empty-state">No operational issues match these filters.</p>}<section className="operations-queue"><div><strong>Client</strong><span>Category</span><span>Issue</span><span>Count</span><span>Action</span></div>{items.map((item) => <article key={item.id}><strong>{item.client}{item.location && <small>{item.location}</small>}</strong><span className="status warning">{item.category}</span><span>{item.issue}</span><b>{item.count}</b><Link href={item.href}>Resolve →</Link></article>)}</section></main>;
}
