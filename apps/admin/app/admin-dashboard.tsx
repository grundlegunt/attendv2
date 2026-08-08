"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "./admin-session";
import { visibleAdminNavigation } from "./admin-navigation";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Bootstrap = {
  location: {
    name: string;
    auditoriums: Array<{ id: string; name: string; capacity: number; seatMap: { id: string } | null }>;
    organization: {
      movies: Array<{ id: string; title: string }>;
      filmSeries: Array<{ id: string; name: string; active: boolean }>;
    };
  };
  showtimes: Array<{ id: string; startsAt: string; onSale: boolean; movie: { title: string }; auditorium: { id: string; name: string; capacity: number } }>;
};

type RevenueReport = {
  totals: { ticketRevenueCents: number; fnbRevenueCents: number; ticketsSold: number };
  showtimes: Array<{ showtimeId: string; startsAt: string; ticketsSold: number }>;
};

type AuditEvent = { id: string; action: string; entityType: string; occurredAt: string };
type Settings = { timeClockEnabled: boolean; ticketTaxRateBasisPoints: number };

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function dayRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

function messageFor(reason: unknown) {
  return reason instanceof ApiRequestError ? reason.body.message : "Some dashboard data could not be loaded.";
}

export function AdminDashboard() {
  const { employee, accessToken } = useAdminSession();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [activity, setActivity] = useState<AuditEvent[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const permissions = useMemo(() => new Set(employee.permissions), [employee.permissions]);
  const canCinema = ["auditorium.manage", "movie.manage", "showtime.manage"].every((permission) => permissions.has(permission));
  const canFinancial = permissions.has("reports.view.financial");
  const canAudit = permissions.has("audit.log.view");
  const canSettings = permissions.has("ticket.price.edit");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrors([]);
      const { from, to } = dayRange();
      const requests: Array<{ key: "bootstrap" | "revenue" | "activity" | "settings"; request: Promise<unknown> }> = [];
      if (canCinema) requests.push({ key: "bootstrap", request: apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }) });
      if (canFinancial) requests.push({ key: "revenue", request: apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken }) });
      if (canAudit) requests.push({ key: "activity", request: apiFetch<AuditEvent[]>("/audit-events?limit=6", { accessToken }) });
      if (canSettings) requests.push({ key: "settings", request: apiFetch<Settings>("/management/settings", { accessToken }) });
      const results = await Promise.allSettled(requests.map((entry) => entry.request));
      if (cancelled) return;
      const failures: string[] = [];
      results.forEach((result, index) => {
        const key = requests[index]?.key;
        if (!key) return;
        if (result.status === "rejected") { failures.push(messageFor(result.reason)); return; }
        if (key === "bootstrap") setBootstrap(result.value as Bootstrap);
        if (key === "revenue") setRevenue(result.value as RevenueReport);
        if (key === "activity") setActivity(result.value as AuditEvent[]);
        if (key === "settings") setSettings(result.value as Settings);
      });
      setErrors([...new Set(failures)]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [accessToken, canAudit, canCinema, canFinancial, canSettings]);

  const { from, to } = dayRange();
  const todaysShowtimes = (bootstrap?.showtimes ?? []).filter((showtime) => {
    const startsAt = new Date(showtime.startsAt);
    return startsAt >= from && startsAt < to;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const navigation = visibleAdminNavigation(employee.permissions);
  const quickActions = navigation.flatMap((group) => group.items).filter((item) => item.href !== "/").slice(0, 5);

  return <main className="admin-route-page dashboard-page">
    <section className="dashboard-heading">
      <div><p className="kicker">OPERATIONS OVERVIEW</p><h1>Dashboard</h1><p>{bootstrap?.location.name ?? "Your cinema"} · {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p></div>
      <Link className="dashboard-primary-action" href={canCinema ? "/scheduling" : quickActions[0]?.href ?? "/"}>{canCinema ? "Open today’s schedule" : "Open management tools"}</Link>
    </section>
    {errors.map((error) => <div className="error-banner" role="alert" key={error}>{error}</div>)}
    <section className="dashboard-metrics" aria-label="Today at a glance">
      {canCinema && <Link href="/scheduling" className="dashboard-metric"><span>Today’s schedule</span><strong>{loading && !bootstrap ? "—" : todaysShowtimes.length}</strong><small>{todaysShowtimes.filter((showtime) => showtime.onSale).length} on sale</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>Ticket revenue</span><strong>{revenue ? money(revenue.totals.ticketRevenueCents) : "—"}</strong><small>{revenue?.totals.ticketsSold ?? 0} tickets sold today</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>F&amp;B revenue</span><strong>{revenue ? money(revenue.totals.fnbRevenueCents) : "—"}</strong><small>Occupancy is not available in current reporting</small></Link>}
      {canCinema && <Link href="/film-series" className="dashboard-metric"><span>Film series</span><strong>{bootstrap?.location.organization.filmSeries.filter((series) => series.active).length ?? "—"}</strong><small>{bootstrap?.location.organization.movies.length ?? 0} movies in library</small></Link>}
    </section>
    <section className="dashboard-grid">
      {canCinema && <section className="panel dashboard-schedule" aria-labelledby="today-schedule-heading"><div className="dashboard-section-heading"><div><p className="kicker">TODAY</p><h2 id="today-schedule-heading">Schedule</h2></div><Link href="/scheduling">View calendar</Link></div>
        <div className="dashboard-list">{todaysShowtimes.slice(0, 6).map((showtime) => <Link href="/scheduling" key={showtime.id}><time>{new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span><strong>{showtime.movie.title}</strong><small>{showtime.auditorium.name}</small></span><b>{showtime.onSale ? "On sale" : "Draft"}</b></Link>)}{!loading && todaysShowtimes.length === 0 && <p className="dashboard-empty">No showtimes are scheduled today.</p>}</div>
      </section>}
      {canCinema && <section className="panel" aria-labelledby="setup-status-heading"><div className="dashboard-section-heading"><div><p className="kicker">READINESS</p><h2 id="setup-status-heading">Cinema setup</h2></div><Link href="/cinema-setup">Manage</Link></div>
        <div className="setup-status"><strong>{bootstrap?.location.auditoriums.length ?? "—"}</strong><span>auditoriums</span><strong>{bootstrap?.location.auditoriums.reduce((total, room) => total + room.capacity, 0) ?? "—"}</strong><span>total seats</span><strong>{bootstrap?.location.auditoriums.filter((room) => room.seatMap).length ?? "—"}</strong><span>seat maps ready</span></div>
        {settings && <p className="dashboard-note">Time clock {settings.timeClockEnabled ? "enabled" : "disabled"} · Ticket tax {(settings.ticketTaxRateBasisPoints / 100).toFixed(2)}%</p>}
      </section>}
      {canAudit && <section className="panel dashboard-activity" aria-labelledby="activity-heading"><div className="dashboard-section-heading"><div><p className="kicker">AUDIT TRAIL</p><h2 id="activity-heading">Recent activity</h2></div><Link href="/audit-log">View all</Link></div>
        <div className="dashboard-list">{activity.map((event) => <Link href="/audit-log" key={event.id}><time>{new Date(event.occurredAt).toLocaleDateString([], { month: "short", day: "numeric" })}</time><span><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.entityType}</small></span></Link>)}{!loading && activity.length === 0 && <p className="dashboard-empty">No recent activity is available.</p>}</div>
      </section>}
      <section className="panel dashboard-quick-actions" aria-labelledby="quick-actions-heading"><p className="kicker">SHORTCUTS</p><h2 id="quick-actions-heading">Quick actions</h2><div>{quickActions.map((item) => <Link href={item.href} key={`${item.href}-${item.label}`}>{item.label}<span aria-hidden="true">→</span></Link>)}</div></section>
    </section>
  </main>;
}
