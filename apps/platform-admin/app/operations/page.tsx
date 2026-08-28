"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanySignIn } from "../company-sign-in";
import { PlatformNav } from "../platform-nav";
import { platformRequest, readPlatformSession, revokePlatformSession } from "../platform-session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
interface Session { accessToken: string; user: { id: string; name: string; email: string; role: "OWNER" | "OPERATOR" | "VIEWER" } }
interface Location { id: string; name: string; active: boolean; configuration: { branding: boolean; auditoriums: number; employees: number; menuItems: number; upcomingShowtimes: number } }
interface Organization { id: string; name: string; payments: { onboardingStatus: string }; health: { failedPayments24h: number; verificationReviews: number; failedRefunds: number; stalePayments: number; staleRefunds: number; managerReviewTabs: number; expiredHoldBacklog: number }; ticketFeeRemittances: Array<{ status: "DUE" | "PAID" | "VOID"; dueDate: string | null; nextFollowUpAt: string | null; platformShareCents: number; collectionOwner: { id: string } | null }>; locations: Location[] }
interface Overview { generatedAt: string; organizations: Organization[] }
type QueueItem = { id: string; client: string; location: string | null; category: "Payments" | "Refunds" | "Ticketing" | "Setup"; issue: string; count: number; exposureCents?: number; href: string; priority: number };

function remittanceAge(dueDate: string | null) {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return Math.max(0, Math.floor((Date.now() - due.getTime()) / 86_400_000));
}

function request<T>(path: string, init?: RequestInit, accessToken?: string) { return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken); }
function label(value: string) { return value.toLowerCase().replaceAll("_", " "); }
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function csvCell(value: string | number) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function priorityLabel(priority: number) { return priority >= 110 ? "Urgent" : priority >= 95 ? "High" : "Standard"; }

function queueItems(organizations: Organization[]): QueueItem[] {
  return organizations.flatMap((organization) => {
    const clientHref = `/clients?organizationId=${encodeURIComponent(organization.id)}`;
    const paymentHref = `/payments?organizationId=${encodeURIComponent(organization.id)}&exceptions=true`;
    const rows: QueueItem[] = [];
    const add = (category: QueueItem["category"], issue: string, count: number, href: string, priority: number, exposureCents?: number) => { if (count > 0) rows.push({ id: `${organization.id}-${category}-${issue}`, client: organization.name, location: null, category, issue, count, exposureCents, href, priority }); };
    if (organization.payments.onboardingStatus !== "COMPLETE") add("Payments", `Stripe setup ${label(organization.payments.onboardingStatus)}`, 1, paymentHref, 90);
    add("Payments", "Failed payments in the last 24 hours", organization.health.failedPayments24h, paymentHref, 100);
    add("Payments", "Payments awaiting verification", organization.health.verificationReviews, paymentHref, 95);
    add("Payments", "Stale processing payments", organization.health.stalePayments, paymentHref, 85);
    const openRemittances = organization.ticketFeeRemittances.filter((remittance) => remittance.status === "DUE");
    const overdue1To30 = openRemittances.filter((remittance) => remittanceAge(remittance.dueDate) >= 1 && remittanceAge(remittance.dueDate) <= 30);
    const overdue31To60 = openRemittances.filter((remittance) => remittanceAge(remittance.dueDate) >= 31 && remittanceAge(remittance.dueDate) <= 60);
    const overdue60Plus = openRemittances.filter((remittance) => remittanceAge(remittance.dueDate) > 60);
    const overdueFollowUps = openRemittances.filter((remittance) => remittance.nextFollowUpAt && new Date(remittance.nextFollowUpAt) < new Date());
    const unscheduledFollowUps = openRemittances.filter((remittance) => !remittance.nextFollowUpAt);
    const unassignedRemittances = openRemittances.filter((remittance) => !remittance.collectionOwner);
    const currentRemittances = openRemittances.filter((remittance) => remittanceAge(remittance.dueDate) === 0);
    const exposure = (remittances: typeof openRemittances) => remittances.reduce((sum, remittance) => sum + remittance.platformShareCents, 0);
    add("Payments", "Unassigned ticket-fee remittances", unassignedRemittances.length, `${paymentHref}&owner=UNASSIGNED`, 112, exposure(unassignedRemittances));
    add("Payments", "Remittances without a scheduled follow-up", unscheduledFollowUps.length, `${paymentHref}&followUp=UNASSIGNED`, 109, exposure(unscheduledFollowUps));
    add("Payments", "Overdue remittance follow-ups", overdueFollowUps.length, `${paymentHref}&followUp=OVERDUE`, 110, exposure(overdueFollowUps));
    add("Payments", "Critical ticket-fee remittances · 60+ days", overdue60Plus.length, `${paymentHref}&age=60_PLUS`, 115, exposure(overdue60Plus));
    add("Payments", "Escalated ticket-fee remittances · 31–60 days", overdue31To60.length, `${paymentHref}&age=31_60`, 108, exposure(overdue31To60));
    add("Payments", "Overdue ticket-fee remittances · 1–30 days", overdue1To30.length, `${paymentHref}&age=1_30`, 102, exposure(overdue1To30));
    add("Payments", "Current ticket-fee remittances", currentRemittances.length, `${paymentHref}&age=CURRENT`, 82, exposure(currentRemittances));
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
  }).sort((left, right) => right.priority - left.priority || (right.exposureCents ?? 0) - (left.exposureCents ?? 0) || right.count - left.count || left.client.localeCompare(right.client));
}

export default function OperationsQueue() {
  const [session, setSession] = useState<Session | null>(null); const [restored, setRestored] = useState(false); const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [refreshing, setRefreshing] = useState(false); const [copied, setCopied] = useState(false); const [query, setQuery] = useState(""); const [client, setClient] = useState("ALL"); const [category, setCategory] = useState("ALL"); const [priority, setPriority] = useState("ALL");
  const authRequestRef = useRef(0);
  const overviewRequestRef = useRef(0);
  const filtersRestoredRef = useRef(false);
  useEffect(() => { setSession(readPlatformSession(STORAGE_KEY)); setRestored(true); }, []);
  useEffect(() => { const params = new URLSearchParams(window.location.search); setQuery(params.get("q") ?? ""); setClient(params.get("client") ?? "ALL"); setCategory(["Payments", "Refunds", "Ticketing", "Setup"].includes(params.get("category") ?? "") ? params.get("category")! : "ALL"); setPriority(["Urgent", "High", "Standard"].includes(params.get("priority") ?? "") ? params.get("priority")! : "ALL"); filtersRestoredRef.current = true; }, []);
  useEffect(() => { if (!filtersRestoredRef.current) return; const params = new URLSearchParams(); if (query) params.set("q", query); if (client !== "ALL") params.set("client", client); if (category !== "ALL") params.set("category", category); if (priority !== "ALL") params.set("priority", priority); const search = params.toString(); window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`); setCopied(false); }, [category, client, priority, query]);
  const refreshOverview = useCallback(async () => {
    if (!session) return;
    const requestId = ++overviewRequestRef.current;
    setRefreshing(true);
    try { const result = await request<Overview>("/platform/overview", undefined, session.accessToken); if (requestId === overviewRequestRef.current) { setOverview(result); setError(null); } }
    catch (reason: unknown) { if (requestId === overviewRequestRef.current) setError(reason instanceof Error ? reason.message : "Could not refresh the operations queue."); }
    finally { if (requestId === overviewRequestRef.current) setRefreshing(false); }
  }, [session]);
  useEffect(() => { if (!session) return; void refreshOverview(); const interval = window.setInterval(() => { void refreshOverview(); }, 60_000); return () => { window.clearInterval(interval); overviewRequestRef.current += 1; }; }, [refreshOverview, session]);
  const allItems = useMemo(() => queueItems(overview?.organizations ?? []), [overview]);
  const clients = useMemo(() => [...new Set(allItems.map((item) => item.client))].sort((left, right) => left.localeCompare(right)), [allItems]);
  const items = useMemo(() => allItems.filter((item) => (client === "ALL" || item.client === client) && (category === "ALL" || item.category === category) && (priority === "ALL" || priorityLabel(item.priority) === priority) && `${item.client} ${item.location ?? ""} ${item.issue}`.toLowerCase().includes(query.trim().toLowerCase())), [allItems, category, client, priority, query]);
  const urgentItems = allItems.filter((item) => priorityLabel(item.priority) === "Urgent");
  const affectedClients = new Set(items.map((item) => item.client)).size;
  function exportOperationsQueue() {
    const columns = ["Client", "Location", "Category", "Issue", "Item count", "Exposure", "Priority", "Resolution URL"];
    const rows = items.map((item) => [item.client, item.location ?? "", item.category, item.issue, item.count, item.exposureCents === undefined ? "" : (item.exposureCents / 100).toFixed(2), item.priority, new URL(item.href, window.location.origin).toString()]);
    const csv = `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ringo-operations-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function copyViewLink() { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setError("Could not copy this Operations view link."); } }
  async function login(event: FormEvent) { event.preventDefault(); const requestId = ++authRequestRef.current; setError(null); try { const result = await request<Session>("/platform/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); if (requestId !== authRequestRef.current) return; window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result)); setSession(result); setPassword(""); } catch (reason) { if (requestId === authRequestRef.current) setError(reason instanceof Error ? reason.message : "Sign in failed."); } }
  function signOut() { authRequestRef.current += 1; overviewRequestRef.current += 1; void revokePlatformSession(API_BASE_URL, session?.accessToken); window.sessionStorage.removeItem(STORAGE_KEY); setSession(null); setOverview(null); setError(null); }
  if (!restored) return <main className="center"><p>Loading Ringo Master…</p></main>;
  if (!session) return <CompanySignIn email={email} password={password} error={error} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={login} />;
  return <main className="shell"><header><div><p className="eyebrow platform-master-label" /><h1>Operations Queue</h1><p className="muted">One prioritized list of operator issues that require Ringo or cinema follow-up.</p></div><div className="identity">{overview && <small>Updated {new Date(overview.generatedAt).toLocaleTimeString()}</small>}<span>{session.user.name}</span><button className="quiet" disabled={refreshing} onClick={() => void refreshOverview()}>{refreshing ? "Refreshing…" : "Refresh queue"}</button><button className="quiet" onClick={signOut}>Sign out</button></div></header><PlatformNav role={session.user.role} />{error && <div className="error">{error}</div>}<section className="operations-summary"><article><span>Open issue groups</span><strong>{allItems.length}</strong></article><button type="button" className="operations-summary-action" onClick={() => setPriority("Urgent")} disabled={urgentItems.length === 0}><span>Urgent groups</span><strong>{urgentItems.length}</strong><small>View urgent only →</small></button><article><span>Shown</span><strong>{items.length}</strong></article><article><span>Affected clients</span><strong>{affectedClients}</strong></article></section><section className="operations-toolbar"><label>Search queue<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, location, or issue" /></label><label>Client<select value={client} onChange={(event) => setClient(event.target.value)}><option value="ALL">All clients</option>{clients.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">All categories</option><option value="Payments">Payments</option><option value="Refunds">Refunds</option><option value="Ticketing">Ticketing</option><option value="Setup">Setup</option></select></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="ALL">All priorities</option><option value="Urgent">Urgent</option><option value="High">High</option><option value="Standard">Standard</option></select></label><button className="quiet" disabled={!query && client === "ALL" && category === "ALL" && priority === "ALL"} onClick={() => { setQuery(""); setClient("ALL"); setCategory("ALL"); setPriority("ALL"); }}>Clear filters</button><button className="quiet" onClick={() => void copyViewLink()}>{copied ? "Link copied" : "Copy view link"}</button><button className="quiet" disabled={items.length === 0} onClick={exportOperationsQueue}>Export queue CSV</button></section>{!overview && <p className="muted">Loading operator exceptions…</p>}{overview && items.length === 0 && <p className="empty-state">No operational issues match these filters.</p>}<section className="operations-queue"><div><strong>Client</strong><span>Category</span><span>Issue</span><span>Priority</span><span>Impact</span><span>Action</span></div>{items.map((item) => <article key={item.id}><strong>{item.client}{item.location && <small>{item.location}</small>}</strong><span className="status warning">{item.category}</span><span>{item.issue}</span><span className={`operations-priority ${priorityLabel(item.priority).toLowerCase()}`}>{priorityLabel(item.priority)}</span><b>{item.count}<small>{item.exposureCents !== undefined ? money(item.exposureCents) : "items"}</small></b><Link href={item.href}>Resolve →</Link></article>)}</section></main>;
}
