"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { startOfLocalDay } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { useAdminSession } from "./admin-session";
import { visibleAdminNavigation } from "./admin-navigation";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Bootstrap = {
  location: {
    name: string;
    timezone: string;
    auditoriums: Array<{ id: string; name: string; capacity: number; seatMap: { id: string } | null }>;
    organization: {
      movies: Array<{ id: string; title: string }>;
      filmSeries: Array<{ id: string; name: string; active: boolean }>;
    };
  };
  showtimes: Array<{ id: string; startsAt: string; onSale: boolean; movie: { id: string; title: string }; auditorium: { id: string; name: string; capacity: number } }>;
};

type RevenueReport = {
  totals: { ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; ticketsSold: number; fnbOrders: number; averageFnbSpendPerOrderCents: number; averageFnbSpendPerSeatCents: number; averageTotalSpendPerPatronCents: number; concessionAttachRatePercent: number };
  movies: Array<{ movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; startsAt: string; ticketsSold: number }>;
  admissionTypes: Array<{ ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>;
  salesChannels: Array<{ channel: "ONLINE" | "BOX_OFFICE"; ticketsSold: number; ticketRevenueCents: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>;
  salesOperators: Array<{ employeeId: string; employeeName: string; ticketsSold: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>;
  concessionTopSellers: Array<{ menuItemId: string; name: string; unitsSold: number; salesCents: number }>;
  dailyPerformance: Array<{ date: string; ticketsSold: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; averageTotalSpendPerPatronCents: number }>;
};

type AuditEvent = { id: string; action: string; entityType: string; occurredAt: string };
type Settings = { timeClockEnabled: boolean; ticketTaxRateBasisPoints: number };
type FilmPerformanceRange = "today" | "7d" | "30d";
type ScheduleDay = "today" | "tomorrow";
type DashboardWidgetId = "metrics" | "topFilms" | "schedule" | "setup" | "activity" | "quickActions";
type DashboardPreferences = { hidden: DashboardWidgetId[]; topOrder: Array<"metrics" | "topFilms">; mainOrder: Array<"schedule" | "activity">; sideOrder: Array<"setup" | "quickActions"> };
const defaultDashboardPreferences: DashboardPreferences = { hidden: [], topOrder: ["metrics", "topFilms"], mainOrder: ["schedule", "activity"], sideOrder: ["setup", "quickActions"] };
const dashboardZones = [
  { label: "Overview", key: "topOrder" as const, widgets: [["metrics", "Today at a glance"], ["topFilms", "Top performing films"]] as const },
  { label: "Main column", key: "mainOrder" as const, widgets: [["schedule", "Schedule"], ["activity", "Recent activity"]] as const },
  { label: "Side column", key: "sideOrder" as const, widgets: [["setup", "Cinema setup"], ["quickActions", "Quick actions"]] as const },
];
type ShowtimeSeatInventory = {
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" }>;
  counts: { available: number; held: number; sold: number; blocked: number };
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function localDayStart(date: Date, timeZone: string, dayOffset = 0) {
  const start = startOfLocalDay(date, timeZone);
  if (!dayOffset) return start;
  // Noon stays within the intended neighboring calendar day across DST shifts;
  // startOfLocalDay then resolves that day's exact UTC boundary.
  return startOfLocalDay(new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000), timeZone);
}

function dayRange(timeZone: string, dayOffset = 0, reference = new Date()) {
  const from = localDayStart(reference, timeZone, dayOffset);
  const to = localDayStart(reference, timeZone, dayOffset + 1);
  return { from, to };
}

function performanceRange(range: FilmPerformanceRange, timeZone: string, reference = new Date()) {
  const daysBack = range === "today" ? 0 : range === "7d" ? 6 : 29;
  return {
    from: localDayStart(reference, timeZone, -daysBack),
    to: localDayStart(reference, timeZone, 1),
  };
}

function scheduleRange(day: ScheduleDay, timeZone: string, reference = new Date()) {
  return dayRange(timeZone, day === "tomorrow" ? 1 : 0, reference);
}

function messageFor(reason: unknown) {
  return reason instanceof ApiRequestError ? reason.body.message : "Some dashboard data could not be loaded.";
}

function DashboardShowtimeRow({
  showtime,
  ticketsSold,
  salesVisible,
  accessToken,
  now,
  timeZone,
}: {
  showtime: Bootstrap["showtimes"][number];
  ticketsSold: number;
  salesVisible: boolean;
  accessToken: string | null;
  now: number;
  timeZone: string;
}) {
  const [inventory, setInventory] = useState<ShowtimeSeatInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const inventoryRequestRef = useRef<AbortController | null>(null);
  const occupancy = showtime.auditorium.capacity
    ? Math.min(100, Math.round((ticketsSold / showtime.auditorium.capacity) * 100))
    : 0;
  const hasStarted = new Date(showtime.startsAt).getTime() <= now;
  const salesClass = !salesVisible
    ? "sales-normal"
    : hasStarted
      ? "sales-normal"
      : occupancy >= 80
        ? "selling-fast"
        : showtime.onSale && occupancy < 20
          ? "sales-low"
          : "sales-normal";

  function loadInventory() {
    if (inventory || inventoryRequestRef.current) return;
    const controller = new AbortController();
    inventoryRequestRef.current = controller;
    setInventoryLoading(true);
    setInventoryError(false);
    apiFetch<ShowtimeSeatInventory>(`/cinema/admin/showtimes/${showtime.id}/seats`, {
      accessToken: accessToken ?? undefined,
      signal: controller.signal,
    })
      .then(setInventory)
      .catch(() => {
        if (!controller.signal.aborted) setInventoryError(true);
      })
      .finally(() => {
        if (inventoryRequestRef.current !== controller) return;
        inventoryRequestRef.current = null;
        setInventoryLoading(false);
      });
  }

  useEffect(() => () => {
    inventoryRequestRef.current?.abort();
    inventoryRequestRef.current = null;
  }, []);

  return (
    <Link
      href={`/scheduling?showtimeId=${encodeURIComponent(showtime.id)}`}
      className={`${salesClass} dashboard-showtime-row`}
      onMouseEnter={loadInventory}
      onFocus={loadInventory}
      aria-label={`Open ${showtime.movie.title} seat map and sales`}
    >
      <time>{new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone })}</time>
      <span><strong>{showtime.movie.title}</strong><small>{showtime.auditorium.name}{salesVisible ? ` · ${ticketsSold}/${showtime.auditorium.capacity} seats` : ` · ${showtime.auditorium.capacity} seats`}</small></span>
      {salesVisible ? <span className="schedule-occupancy"><i><span style={{ width: `${occupancy}%` }} /></i><b>{occupancy}%</b></span> : <span aria-hidden="true" />}
      <em>{hasStarted ? "Started" : salesVisible && occupancy >= 80 ? "Selling fast" : salesVisible && showtime.onSale && occupancy < 20 ? "Low sales" : showtime.onSale ? "On sale" : "Draft"}</em>
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

function TopFilmRow({ film, rank, topTicketCount, showtime, accessToken, timeZone }: {
  film: RevenueReport["movies"][number];
  rank: number;
  topTicketCount: number;
  showtime: Bootstrap["showtimes"][number] | undefined;
  accessToken: string;
  timeZone: string;
}) {
  const [inventory, setInventory] = useState<ShowtimeSeatInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const inventoryRequestRef = useRef<AbortController | null>(null);

  function loadInventory() {
    if (!showtime || inventory || inventoryRequestRef.current) return;
    const controller = new AbortController();
    inventoryRequestRef.current = controller;
    setInventoryLoading(true);
    setInventoryError(false);
    apiFetch<ShowtimeSeatInventory>(`/cinema/admin/showtimes/${showtime.id}/seats`, { accessToken, signal: controller.signal })
      .then(setInventory)
      .catch(() => { if (!controller.signal.aborted) setInventoryError(true); })
      .finally(() => {
        if (inventoryRequestRef.current !== controller) return;
        inventoryRequestRef.current = null;
        setInventoryLoading(false);
      });
  }

  useEffect(() => () => {
    inventoryRequestRef.current?.abort();
    inventoryRequestRef.current = null;
  }, []);

  return <Link className="top-film-row" href={`/reports#movie-${encodeURIComponent(film.movieId)}`} onMouseEnter={loadInventory} onFocus={loadInventory} aria-label={`Open ${film.title} revenue report`}>
    <span className="top-film-rank">{rank}</span><strong>{film.title}</strong><div className="top-film-track"><span style={{ width: `${Math.max(5, (film.ticketsSold / topTicketCount) * 100)}%` }} /></div><b>{film.ticketsSold} {film.ticketsSold === 1 ? "ticket" : "tickets"}</b><small>{money(film.ticketRevenueCents)}</small>
    <aside className="dashboard-seat-preview top-film-seat-preview">
      <header><span><strong>{film.title}</strong><small>{showtime ? `${showtime.auditorium.name} · ${new Date(showtime.startsAt).toLocaleString([], { timeZone })}` : "No scheduled showtime available"}</small></span>{inventory && <b>{inventory.counts.sold}/{inventory.seats.length} sold</b>}</header>
      {inventory ? <><SeatMap seats={inventory.seats.map((seat) => ({ ...seat, state: seat.state === "AVAILABLE" ? "available" : "unavailable" }))} label={`${film.title} seat inventory preview`} /><footer><span>{inventory.counts.available} available</span><span>{inventory.counts.held} held</span><span>{inventory.counts.sold} sold</span><span>{inventory.counts.blocked} blocked</span></footer></> : inventoryError ? <p>Seat map unavailable.</p> : <p>{inventoryLoading ? "Loading live seat map…" : showtime ? "Hover to load the closest showing’s live seat map." : "Schedule a showing to preview its seat map."}</p>}
    </aside>
  </Link>;
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
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences);
  const [preferenceDraft, setPreferenceDraft] = useState<DashboardPreferences>(defaultDashboardPreferences);
  const [customizing, setCustomizing] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const preferenceAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const permissions = useMemo(() => new Set(employee.permissions), [employee.permissions]);
  const canCinema = ["auditorium.manage", "movie.manage", "showtime.manage"].every((permission) => permissions.has(permission));
  const canFinancial = permissions.has("reports.view.financial");
  const canAudit = permissions.has("audit.log.view");
  const canSettings = permissions.has("ticket.price.edit");
  const locationTimeZone = bootstrap?.location.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locationDayStart = localDayStart(now, locationTimeZone).toISOString();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrors([]);
      const requests: Array<{ key: "bootstrap" | "activity" | "settings"; request: Promise<unknown> }> = [];
      if (canCinema) requests.push({ key: "bootstrap", request: apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }) });
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
        if (key === "activity") setActivity(result.value as AuditEvent[]);
        if (key === "settings") setSettings(result.value as Settings);
      });
      setErrors([...new Set(failures)]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [accessToken, canAudit, canCinema, canSettings]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DashboardPreferences>("/management/dashboard-preferences", { accessToken })
      .then((result) => { if (!cancelled) { setPreferences(result); setPreferenceDraft(result); } })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); });
    return () => { cancelled = true; };
  }, [accessToken]);

  async function savePreferences() {
    if (savingPreferences) return;
    const body = JSON.stringify(preferenceDraft);
    if (preferenceAttemptRef.current?.fingerprint !== body) preferenceAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    setSavingPreferences(true);
    try {
      const saved = await apiFetch<DashboardPreferences>("/management/dashboard-preferences", { accessToken, method: "PATCH", headers: { "Idempotency-Key": preferenceAttemptRef.current.requestId }, body });
      preferenceAttemptRef.current = null;
      setPreferences(saved); setPreferenceDraft(saved); setCustomizing(false);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) preferenceAttemptRef.current = null;
      setErrors((current) => [...new Set([...current, messageFor(reason)])]);
    } finally { setSavingPreferences(false); }
  }

  function toggleWidget(id: DashboardWidgetId) {
    setPreferenceDraft((current) => ({ ...current, hidden: current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id] }));
  }

  function moveWidget(zone: "topOrder" | "mainOrder" | "sideOrder", id: DashboardWidgetId, direction: -1 | 1) {
    setPreferenceDraft((current) => {
      const order = [...current[zone]] as DashboardWidgetId[];
      const index = order.indexOf(id); const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target]!, order[index]!];
      return { ...current, [zone]: order } as DashboardPreferences;
    });
  }

  useEffect(() => {
    if (!canFinancial || (canCinema && !bootstrap)) return;
    let cancelled = false;
    const { from, to } = dayRange(locationTimeZone, 0, new Date(locationDayStart));
    apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken })
      .then((result) => { if (!cancelled) setRevenue(result); })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); });
    return () => { cancelled = true; };
  }, [accessToken, bootstrap, canCinema, canFinancial, locationDayStart, locationTimeZone]);

  useEffect(() => {
    if (!canFinancial || (canCinema && !bootstrap)) return;
    let cancelled = false;
    const { from, to } = performanceRange(filmRange, locationTimeZone, new Date(locationDayStart));
    setFilmRevenueLoading(true);
    apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken })
      .then((result) => { if (!cancelled) setFilmRevenue(result); })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); })
      .finally(() => { if (!cancelled) setFilmRevenueLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, bootstrap, canCinema, canFinancial, filmRange, locationDayStart, locationTimeZone]);

  useEffect(() => {
    if (!canFinancial || !canCinema || !bootstrap) return;
    let cancelled = false;
    const { from, to } = scheduleRange(scheduleDay, locationTimeZone, new Date(locationDayStart));
    setScheduleRevenueLoading(true);
    apiFetch<RevenueReport>(`/reports/revenue?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { accessToken })
      .then((result) => { if (!cancelled) setScheduleRevenue(result); })
      .catch((reason) => { if (!cancelled) setErrors((current) => [...new Set([...current, messageFor(reason)])]); })
      .finally(() => { if (!cancelled) setScheduleRevenueLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, bootstrap, canCinema, canFinancial, locationDayStart, locationTimeZone, scheduleDay]);

  const { from, to } = dayRange(locationTimeZone, 0, now);
  const todaysShowtimes = (bootstrap?.showtimes ?? []).filter((showtime) => {
    const startsAt = new Date(showtime.startsAt);
    return startsAt >= from && startsAt < to;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const selectedScheduleRange = scheduleRange(scheduleDay, locationTimeZone, now);
  const scheduleShowtimes = (bootstrap?.showtimes ?? []).filter((showtime) => {
    const startsAt = new Date(showtime.startsAt);
    return startsAt >= selectedScheduleRange.from && startsAt < selectedScheduleRange.to;
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const scheduleSales = new Map((scheduleRevenue?.showtimes ?? []).map((showtime) => [showtime.showtimeId, showtime.ticketsSold]));
  const navigation = visibleAdminNavigation(employee.permissions);
  const quickActions = navigation.flatMap((group) => group.items).filter((item) => item.href !== "/").slice(0, 5);
  const topFilms = [...(filmRevenue?.movies ?? [])].sort((a, b) => b.ticketsSold - a.ticketsSold || b.ticketRevenueCents - a.ticketRevenueCents).slice(0, 5);
  const topTicketCount = Math.max(1, ...topFilms.map((film) => film.ticketsSold));
  const closestShowtimeByMovie = new Map<string, Bootstrap["showtimes"][number]>();
  for (const showtime of bootstrap?.showtimes ?? []) {
    const current = closestShowtimeByMovie.get(showtime.movie.id);
    if (!current || Math.abs(new Date(showtime.startsAt).getTime() - now.getTime()) < Math.abs(new Date(current.startsAt).getTime() - now.getTime())) closestShowtimeByMovie.set(showtime.movie.id, showtime);
  }
  const filmRangeLabel = filmRange === "today" ? "Today" : filmRange === "7d" ? "Last 7 days" : "Last 30 days";
  const visible = (id: DashboardWidgetId) => !preferences.hidden.includes(id);

  return <main className="admin-route-page dashboard-page">
    <section className="dashboard-heading">
      <div><p className="kicker">OPERATIONS OVERVIEW</p><h1>Dashboard</h1><p>{bootstrap?.location.name ?? "Your cinema"} · {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: locationTimeZone })}</p></div>
      <div className="dashboard-heading-actions"><button type="button" className="secondary-button" onClick={() => { setPreferenceDraft(preferences); setCustomizing((current) => !current); }}>{customizing ? "Close customization" : "Customize dashboard"}</button><Link className="dashboard-primary-action" href={canCinema ? "/scheduling" : quickActions[0]?.href ?? "/"}>{canCinema ? "Open today’s schedule" : "Open management tools"}</Link></div>
    </section>
    {errors.map((error) => <div className="error-banner" role="alert" key={error}>{error}</div>)}
    {customizing && <section className="panel dashboard-customizer" aria-labelledby="dashboard-customizer-heading"><div className="dashboard-section-heading"><div><p className="kicker">YOUR WORKSPACE</p><h2 id="dashboard-customizer-heading">Customize dashboard</h2><p>Choose what appears and arrange widgets within each area. These settings apply only to your account.</p></div></div><div className="dashboard-customizer-zones">{dashboardZones.map((zone) => <fieldset key={zone.key}><legend>{zone.label}</legend>{preferenceDraft[zone.key].map((id, index) => { const label = zone.widgets.find(([widgetId]) => widgetId === id)?.[1] ?? id; return <div className="dashboard-widget-option" key={id}><label><input type="checkbox" checked={!preferenceDraft.hidden.includes(id)} onChange={() => toggleWidget(id)} />{label}</label><span><button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => moveWidget(zone.key, id, -1)}>↑</button><button type="button" aria-label={`Move ${label} down`} disabled={index === preferenceDraft[zone.key].length - 1} onClick={() => moveWidget(zone.key, id, 1)}>↓</button></span></div>; })}</fieldset>)}</div><div className="dashboard-customizer-actions"><button type="button" className="secondary-button" onClick={() => setPreferenceDraft(defaultDashboardPreferences)}>Reset</button><button type="button" className="secondary-button" onClick={() => { setPreferenceDraft(preferences); setCustomizing(false); }}>Cancel</button><button type="button" className="primary-button" disabled={savingPreferences} onClick={() => void savePreferences()}>{savingPreferences ? "Saving…" : "Save dashboard"}</button></div></section>}
    <div className="dashboard-top-widgets">
    {visible("metrics") && <section className="dashboard-metrics" aria-label="Today at a glance" style={{ order: preferences.topOrder.indexOf("metrics") }}>
      {canCinema && <Link href="/scheduling" className="dashboard-metric"><span>Today’s schedule</span><strong>{loading && !bootstrap ? "—" : todaysShowtimes.length}</strong><small>{todaysShowtimes.filter((showtime) => showtime.onSale).length} on sale</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>Ticket face value</span><strong>{revenue ? money(revenue.totals.ticketRevenueCents) : "—"}</strong><small>{revenue ? `${money(revenue.totals.ticketCollectedCents)} collected · ${revenue.totals.ticketsSold} tickets` : "0 tickets sold today"}</small></Link>}
      {canFinancial && <Link href="/reports" className="dashboard-metric"><span>F&amp;B revenue</span><strong>{revenue ? money(revenue.totals.fnbRevenueCents) : "—"}</strong><small>{revenue ? `${revenue.totals.fnbOrders} orders · ${money(revenue.totals.averageFnbSpendPerOrderCents)} average` : "Average spend unavailable"}</small></Link>}
      {canCinema && <Link href="/film-series" className="dashboard-metric"><span>Film series</span><strong>{bootstrap?.location.organization.filmSeries.filter((series) => series.active).length ?? "—"}</strong><small>{bootstrap?.location.organization.movies.length ?? 0} movies in library</small></Link>}
    </section>}
    {canFinancial && visible("topFilms") && <section className="panel dashboard-top-films" aria-labelledby="top-films-heading" style={{ order: preferences.topOrder.indexOf("topFilms") }}>
      <div className="dashboard-section-heading"><div><p className="kicker">TICKET SALES · {filmRangeLabel.toUpperCase()}</p><h2 id="top-films-heading">Top performing films</h2></div><div className="top-film-heading-actions"><div className="top-film-range" role="group" aria-label="Top performing films reporting period"><button type="button" className={filmRange === "today" ? "active" : ""} onClick={() => setFilmRange("today")}>Today</button><button type="button" className={filmRange === "7d" ? "active" : ""} onClick={() => setFilmRange("7d")}>7 days</button><button type="button" className={filmRange === "30d" ? "active" : ""} onClick={() => setFilmRange("30d")}>30 days</button></div><Link href="/reports">View report</Link></div></div>
      {filmRevenueLoading && !filmRevenue ? <p className="dashboard-empty">Loading film performance…</p> : topFilms.length ? <div className={`top-film-list ${filmRevenueLoading ? "loading" : ""}`}>{topFilms.map((film, index) => <TopFilmRow film={film} rank={index + 1} topTicketCount={topTicketCount} showtime={closestShowtimeByMovie.get(film.movieId)} accessToken={accessToken} timeZone={locationTimeZone} key={film.movieId} />)}</div> : <p className="dashboard-empty">No ticket sales were recorded for {filmRangeLabel.toLowerCase()}.</p>}
    </section>}
    </div>
    <section className="dashboard-grid">
      <div className="dashboard-column">
      {canCinema && visible("schedule") && <section className="panel dashboard-schedule" aria-labelledby="today-schedule-heading" style={{ order: preferences.mainOrder.indexOf("schedule") }}><div className="dashboard-section-heading"><div><p className="kicker">PROGRAMMING</p><h2 id="today-schedule-heading">Schedule</h2></div><div className="schedule-heading-actions"><div className="dashboard-day-switch" role="group" aria-label="Schedule day"><button type="button" className={scheduleDay === "today" ? "active" : ""} onClick={() => setScheduleDay("today")}>Today</button><button type="button" className={scheduleDay === "tomorrow" ? "active" : ""} onClick={() => setScheduleDay("tomorrow")}>Tomorrow</button></div><Link href="/scheduling">View calendar</Link></div></div>
        <div className={`dashboard-list schedule-dashboard-list ${scheduleRevenueLoading ? "loading" : ""}`}>{scheduleShowtimes.map((showtime) => {
          const ticketsSold = scheduleSales.get(showtime.id) ?? 0;
          const salesVisible = canFinancial && scheduleRevenue !== null;
          return <DashboardShowtimeRow key={showtime.id} showtime={showtime} ticketsSold={ticketsSold} salesVisible={salesVisible} accessToken={accessToken} now={now.getTime()} timeZone={locationTimeZone} />;
        })}{!loading && scheduleShowtimes.length === 0 && <p className="dashboard-empty">No showtimes are scheduled {scheduleDay}.</p>}</div>
      </section>}
      {canAudit && visible("activity") && <section className="panel dashboard-activity" aria-labelledby="activity-heading" style={{ order: preferences.mainOrder.indexOf("activity") }}><div className="dashboard-section-heading"><div><p className="kicker">AUDIT TRAIL</p><h2 id="activity-heading">Recent activity</h2></div><Link href="/audit-log">View all</Link></div>
        <div className="dashboard-list">{activity.map((event) => <Link href="/audit-log" key={event.id}><time>{new Date(event.occurredAt).toLocaleDateString([], { month: "short", day: "numeric", timeZone: locationTimeZone })}</time><span><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.entityType}</small></span></Link>)}{!loading && activity.length === 0 && <p className="dashboard-empty">No recent activity is available.</p>}</div>
      </section>}
      </div>
      <div className="dashboard-column">
      {canCinema && visible("setup") && <section className="panel" aria-labelledby="setup-status-heading" style={{ order: preferences.sideOrder.indexOf("setup") }}><div className="dashboard-section-heading"><div><p className="kicker">READINESS</p><h2 id="setup-status-heading">Cinema setup</h2></div><Link href="/cinema-setup">Manage</Link></div>
        <div className="setup-status"><strong>{bootstrap?.location.auditoriums.length ?? "—"}</strong><span>auditoriums</span><strong>{bootstrap?.location.auditoriums.reduce((total, room) => total + room.capacity, 0) ?? "—"}</strong><span>total seats</span><strong>{bootstrap?.location.auditoriums.filter((room) => room.seatMap).length ?? "—"}</strong><span>seat maps ready</span></div>
        {settings && <p className="dashboard-note">Time clock {settings.timeClockEnabled ? "enabled" : "disabled"} · Ticket tax {(settings.ticketTaxRateBasisPoints / 100).toFixed(2)}%</p>}
      </section>}
      {visible("quickActions") && <section className="panel dashboard-quick-actions" aria-labelledby="quick-actions-heading" style={{ order: preferences.sideOrder.indexOf("quickActions") }}><p className="kicker">SHORTCUTS</p><h2 id="quick-actions-heading">Quick actions</h2><div>{quickActions.map((item) => <Link href={item.href} key={`${item.href}-${item.label}`}>{item.label}<span aria-hidden="true">→</span></Link>)}</div></section>}
      </div>
    </section>
  </main>;
}
