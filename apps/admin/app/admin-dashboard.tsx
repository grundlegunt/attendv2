"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
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
  totals: { ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; ticketsSold: number; fnbOrders: number; averageFnbSpendPerOrderCents: number; averageFnbSpendPerSeatCents: number };
  movies: Array<{ movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; startsAt: string; ticketsSold: number }>;
};

type AuditEvent = { id: string; action: string; entityType: string; occurredAt: string };
type Settings = { timeClockEnabled: boolean; ticketTaxRateBasisPoints: number };
type FilmPerformanceRange = "today" | "7d" | "30d";
type ScheduleDay = "today" | "tomorrow";
type ShowtimeSeatInventory = {
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" }>;
  counts: { available: number; held: number; sold: number; blocked: number };
};

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

function performanceRange(range: FilmPerformanceRange) {
  const { from, to } = dayRange();
  if (range !== "today") from.setDate(from.getDate() - (range === "7d" ? 6 : 29));
  return { from, to };
}

function scheduleRange(day: ScheduleDay) {
  const { from, to } = dayRange();
  if (day === "tomorrow") {
    from.setDate(from.getDate() + 1);
    to.setDate(to.getDate() + 1);
  }
  return { from, to };
}

function messageFor(reason: unknown) {
  return reason instanceof ApiRequestError ? reason.body.message : "Some dashboard data could not be loaded.";
}

function DashboardShowtimeRow({
  showtime,
  ticketsSold,
  salesVisible,
  accessToken,
}: {
  showtime: Bootstrap["showtimes"][number];
  ticketsSold: number;
  salesVisible: boolean;
  accessToken: string | null;
}) {
  const [inventory, setInventory] = useState<ShowtimeSeatInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const occupancy = showtime.auditorium.capacity
    ? Math.min(100, Math.round((ticketsSold / showtime.auditorium.capacity) * 100))
    : 0;
  const salesClass = !salesVisible
    ? "sales-normal"
    : occupancy >= 80
      ? "selling-fast"
      : showtime.onSale && occupancy < 20
        ? "sales-low"
        : "sales-normal";

  function loadInventory() {
    if (inventory || inventoryLoading || inventoryError) return;
    setInventoryLoading(true);
    apiFetch<ShowtimeSeatInventory>(`/cinema/showtimes/${showtime.id}/seats`, {
      accessToken: accessToken ?? undefined,
    })
      .then(setInventory)
      .catch(() => setInventoryError(true))
      .finally(() => setInventoryLoading(false));
  }

  return (
    <Link
      href={`/scheduling?showtimeId=${encodeURIComponent(showtime.id)}`}
      className={`${salesClass} dashboard-showtime-row`}
      onMouseEnter={loadInventory}
      onFocus={loadInventory}
      aria-label={`Open ${showtime.movie.title} seat map and sales`}
    >
      <time>{new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
      <span><strong>{showtime.movie.title}</strong><small>{showtime.auditorium.name}{salesVisible ? ` · ${ticketsSold}/${showtime.auditorium.capacity} seats` : ` · ${showtime.auditorium.capacity} seats`}</small></span>
      {salesVisible ? <span className="schedule-occupancy"><i><span style={{ width: `${occupancy}%` }} /></i><b>{occupancy}%</b></span> : <span aria-hidden="true" />}
      <em>{salesVisible && occupancy >= 80 ? "Selling fast" : salesVisible && showtime.onSale && occupancy < 20 ? "Low sales" : showtime.onSale ? "On sale" : "Draft"}</em>
      <aside className="dashboard-seat-preview">
        <header><span><strong>{showtime.movie.title}</strong><small>{showtime.auditorium.name} · Click for full sales view</small></span>{inventory && <b>{inventory.counts.sold}/{inventory.seats.length} sold</b>}</header>
        {inventory ? <>
          <SeatMap
            seats={inventory.seats.map((seat) => ({ ...seat, state: seat.state === "AVAILABLE" ? "available" : "unavailable" }))}
            label={`${showtime.movie.title} seat inventory preview`}
          />
          <footer><span>{inventory.counts.available} available</span><span>{inventory.counts.held} held</span><span>{inventory.counts.sold} sold</span><span>{inventory.counts.blocked} blocked</span></footer>
        </> : inventoryError ? <p>Seat map unavailable.</p> : <p>{inventoryLoading ? "Loading live seat map…" : "Hover to load live seat map."}</p>}
      </aside>
    </Link>
  );
}

export function AdminDashboard() {
  const { employee, accessToken } = useAdminSession();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [filmRevenue, setFilmRevenue] = useState<RevenueReport | null>(null);
  const [filmRange, setFilmRange] = useState<FilmPerformanceRange>("today");
  const [filmRevenueLoading, setFilmRevenueLoading] = useState(false);
  const [scheduleDay, setScheduleDay] = useState<ScheduleDay>("today");
  const [scheduleRevenue, setScheduleRevenue] = useState<RevenueReport | null>(null);
  const [scheduleRevenueLoading, setScheduleRevenueLoading] = useState(false);
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

  useEffect(() => {
    if (!canFinancial) return;
    let cancelled = false;
    const { from, to } = performanceRange(filmRange);
    setFilmRevenueLoading(true);
    apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken })
      .then((result) => { if (!cancelled) setFilmRevenue(result); })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); })
      .finally(() => { if (!cancelled) setFilmRevenueLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, canFinancial, filmRange]);

  useEffect(() => {
    if (!canFinancial || !canCinema) return;
    let cancelled = false;
    const { from, to } = scheduleRange(scheduleDay);
    setScheduleRevenueLoading(true);
    apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken })
      .then((result) => { if (!cancelled) setScheduleRevenue(result); })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); })
      .finally(() => { if (!cancelled) setScheduleRevenueLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, canCinema, canFinancial, scheduleDay]);

  const { from, to } = dayRange();
  const todaysShowtimes = (bootstrap?.showtimes ?? []).filter((showtime) => {
    const startsAt = new Date(showtime.startsAt);
    return startsAt >= from && startsAt < to;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const selectedScheduleRange = scheduleRange(scheduleDay);
  const scheduleShowtimes = (bootstrap?.showtimes ?? []).filter((showtime) => {
    const startsAt = new Date(showtime.startsAt);
    return startsAt >= selectedScheduleRange.from && startsAt < selectedScheduleRange.to;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const scheduleSales = new Map((scheduleRevenue?.showtimes ?? []).map((showtime) => [showtime.showtimeId, showtime.ticketsSold]));
  const navigation = visibleAdminNavigation(employee.permissions);
  const quickActions = navigation.flatMap((group) => group.items).filter((item) => item.href !== "/").slice(0, 5);
  const topFilms = [...(filmRevenue?.movies ?? [])].sort((a, b) => b.ticketsSold - a.ticketsSold || b.ticketRevenueCents - a.ticketRevenueCents).slice(0, 5);
  const topTicketCount = Math.max(1, ...topFilms.map((film) => film.ticketsSold));
  const filmRangeLabel = filmRange === "today" ? "Today" : filmRange === "7d" ? "Last 7 days" : "Last 30 days";

  return <main className="admin-route-page dashboard-page">
    <section className="dashboard-heading">
      <div><p className="kicker">OPERATIONS OVERVIEW</p><h1>Dashboard</h1><p>{bootstrap?.location.name ?? "Your cinema"} · {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p></div>
      <Link className="dashboard-primary-action" href={canCinema ? "/scheduling" : quickActions[0]?.href ?? "/"}>{canCinema ? "Open today’s schedule" : "Open management tools"}</Link>
    </section>
    {errors.map((error) => <div className="error-banner" role="alert" key={error}>{error}</div>)}
    <section className="dashboard-metrics" aria-label="Today at a glance">
      {canCinema && <Link href="/scheduling" className="dashboard-metric"><span>Today’s schedule</span><strong>{loading && !bootstrap ? "—" : todaysShowtimes.length}</strong><small>{todaysShowtimes.filter((showtime) => showtime.onSale).length} on sale</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>Ticket face value</span><strong>{revenue ? money(revenue.totals.ticketRevenueCents) : "—"}</strong><small>{revenue ? `${money(revenue.totals.ticketCollectedCents)} collected · ${revenue.totals.ticketsSold} tickets` : "0 tickets sold today"}</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>F&amp;B revenue</span><strong>{revenue ? money(revenue.totals.fnbRevenueCents) : "—"}</strong><small>{revenue ? `${revenue.totals.fnbOrders} orders · ${money(revenue.totals.averageFnbSpendPerOrderCents)} average` : "Average spend unavailable"}</small></Link>}
      {canCinema && <Link href="/film-series" className="dashboard-metric"><span>Film series</span><strong>{bootstrap?.location.organization.filmSeries.filter((series) => series.active).length ?? "—"}</strong><small>{bootstrap?.location.organization.movies.length ?? 0} movies in library</small></Link>}
    </section>
    {canFinancial && <section className="panel dashboard-top-films" aria-labelledby="top-films-heading">
      <div className="dashboard-section-heading"><div><p className="kicker">TICKET SALES · {filmRangeLabel.toUpperCase()}</p><h2 id="top-films-heading">Top performing films</h2></div><div className="top-film-heading-actions"><div className="top-film-range" role="group" aria-label="Top performing films reporting period"><button type="button" className={filmRange === "today" ? "active" : ""} onClick={() => setFilmRange("today")}>Today</button><button type="button" className={filmRange === "7d" ? "active" : ""} onClick={() => setFilmRange("7d")}>7 days</button><button type="button" className={filmRange === "30d" ? "active" : ""} onClick={() => setFilmRange("30d")}>30 days</button></div><Link href="/reports">View report</Link></div></div>
      {filmRevenueLoading && !filmRevenue ? <p className="dashboard-empty">Loading film performance…</p> : topFilms.length ? <div className={`top-film-list ${filmRevenueLoading ? "loading" : ""}`}>{topFilms.map((film, index) => <Link className="top-film-row" href={`/scheduling?movieId=${encodeURIComponent(film.movieId)}`} key={film.movieId} aria-label={`Open ${film.title} in scheduling`}>
        <span className="top-film-rank">{index + 1}</span><strong>{film.title}</strong><div className="top-film-track"><span style={{ width: `${Math.max(5, (film.ticketsSold / topTicketCount) * 100)}%` }} /></div><b>{film.ticketsSold} {film.ticketsSold === 1 ? "ticket" : "tickets"}</b><small>{money(film.ticketRevenueCents)}</small>
      </Link>)}</div> : <p className="dashboard-empty">No ticket sales were recorded for {filmRangeLabel.toLowerCase()}.</p>}
    </section>}
    <section className="dashboard-grid">
      {canCinema && <section className="panel dashboard-schedule" aria-labelledby="today-schedule-heading"><div className="dashboard-section-heading"><div><p className="kicker">PROGRAMMING</p><h2 id="today-schedule-heading">Schedule</h2></div><div className="schedule-heading-actions"><div className="dashboard-day-switch" role="group" aria-label="Schedule day"><button type="button" className={scheduleDay === "today" ? "active" : ""} onClick={() => setScheduleDay("today")}>Today</button><button type="button" className={scheduleDay === "tomorrow" ? "active" : ""} onClick={() => setScheduleDay("tomorrow")}>Tomorrow</button></div><Link href="/scheduling">View calendar</Link></div></div>
        <div className={`dashboard-list schedule-dashboard-list ${scheduleRevenueLoading ? "loading" : ""}`}>{scheduleShowtimes.slice(0, 8).map((showtime) => {
          const ticketsSold = scheduleSales.get(showtime.id) ?? 0;
          const salesVisible = canFinancial && scheduleRevenue !== null;
          return <DashboardShowtimeRow key={showtime.id} showtime={showtime} ticketsSold={ticketsSold} salesVisible={salesVisible} accessToken={accessToken} />;
        })}{!loading && scheduleShowtimes.length === 0 && <p className="dashboard-empty">No showtimes are scheduled {scheduleDay}.</p>}</div>
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
