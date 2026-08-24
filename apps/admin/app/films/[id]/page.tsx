"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SeatMap, type SeatMapSeat, type SeatMapSeatingStyle } from "@cinema/ui";
import { useAdminSession } from "../../admin-session";
import { apiFetch, ApiRequestError } from "../../lib/api-client";

type Performance = {
  movie: { id: string; title: string; synopsis: string | null; runtimeMinutes: number; rating: string | null; posterUrl: string | null; director: string | null; starring: string | null; releaseYear: number | null; distributorName: string | null; active: boolean };
  location: { name: string; timezone: string; currency: string };
  totals: { showtimes: number; upcomingShowtimes: number; pastShowtimes: number; ticketsSold: number; totalCapacity: number; attendancePercent: number; averageTicketsPerShow: number; averageTicketCents: number; ticketRevenueCents: number; fnbRevenueCents: number; averageFnbPerShowCents: number; averageFnbPerTicketCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; discountCents: number; complimentaryTickets: number; refundedTickets: number; refundedTicketValueCents: number; firstShowtime: string | null; lastShowtime: string | null; calendarWeeks: number; averageShowtimesPerWeek: number };
  series: Array<{ id: string; name: string }>;
  admissionTypes: Array<{ ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>;
  salesChannels: Array<{ channel: "ONLINE" | "BOX_OFFICE"; ticketsSold: number; ticketRevenueCents: number }>;
  promotions: Array<{ promotionId: string; code: string; name: string; type: string; orders: number; tickets: number; discountCents: number }>;
  auditoriumPerformance: PerformanceSlice[];
  daypartPerformance: PerformanceSlice[];
  weeklyPerformance: Array<{ theatricalWeek: number; firstShowtime: string; lastShowtime: string; showtimes: number; ticketsSold: number; capacity: number; attendancePercent: number; averageTicketsPerShow: number; ticketRevenueCents: number; fnbRevenueCents: number; averageFnbPerShowCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; startsAt: string; auditorium: { id: string; name: string; capacity: number }; filmSeries: { id: string; name: string } | null; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number; theatricalWeek: number | null; distributorShareBasisPoints: number | null; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>;
};
type PerformanceSlice = { key: string; label: string; showtimes: number; ticketsSold: number; capacity: number; attendancePercent: number; averageTicketsPerShow: number; ticketRevenueCents: number; averageTicketRevenuePerShowCents: number; fnbRevenueCents: number; averageFnbPerShowCents: number };
type Period = "all" | "30" | "90" | "365";
type TicketMap = {
  showtime: { id: string; currency: string; seatingStyle: SeatMapSeatingStyle };
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED"; ticket: { id: string; status: string; priceCentsPaid: number; ticketType: { name: string }; ticketOrder: { orderNumber: string; channel: string } } | null }>;
  counts: { available: number; held: number; sold: number; blocked: number };
};

function money(cents: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }

function ShowtimeTicketMap({ showtimeId, accessToken }: { showtimeId: string; accessToken: string }) {
  const [open, setOpen] = useState(false); const [ticketMap, setTicketMap] = useState<TicketMap | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (ticketMap || loading) return;
    setLoading(true); setError(null);
    apiFetch<TicketMap>(`/reports/showtimes/${showtimeId}/ticket-map`, { accessToken })
      .then(setTicketMap)
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Ticket map could not be loaded."))
      .finally(() => setLoading(false));
  }
  const soldSeats = ticketMap?.seats.filter((seat) => seat.ticket) ?? [];
  return <><button type="button" className="showtime-ticket-map-toggle" aria-expanded={open} onClick={toggle}>{open ? "Hide ticket map" : "View ticket map"}</button>{open && <section className="showtime-ticket-map" aria-label="Showtime ticket map">{loading && <p>Loading ticket map…</p>}{error && <div className="error-banner" role="alert">{error}</div>}{ticketMap && <><SeatMap seats={ticketMap.seats.map((seat) => ({ ...seat, state: seat.state === "SOLD" ? "selected" : seat.state === "AVAILABLE" ? "available" : "unavailable" }))} seatingStyle={ticketMap.showtime.seatingStyle} label="Sold-seat map" /><div className="ticket-map-counts"><span>{ticketMap.counts.sold} sold</span><span>{ticketMap.counts.held} held</span><span>{ticketMap.counts.available} available</span><span>{ticketMap.counts.blocked} blocked</span></div>{soldSeats.length > 0 && <div className="sold-seat-ledger">{soldSeats.map((seat) => <div key={seat.id}><strong>{seat.label}</strong><span>{seat.ticket!.ticketType.name} · {money(seat.ticket!.priceCentsPaid, ticketMap.showtime.currency)}</span><small>{seat.ticket!.ticketOrder.orderNumber} · {seat.ticket!.ticketOrder.channel.toLowerCase()}</small></div>)}</div>}</>}</section>}</>;
}

export default function FilmPerformancePage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, employee } = useAdminSession();
  const [period, setPeriod] = useState<Period>("all");
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const path = useMemo(() => {
    if (period === "all") return `/reports/movies/${id}`;
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    return `/reports/movies/${id}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [id, period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    apiFetch<Performance>(path, { accessToken })
      .then((result) => { if (!cancelled) setPerformance(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Film performance could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, path]);

  if (!employee.permissions.includes("reports.view.financial")) return <main className="admin-route-page"><div className="error-banner" role="alert">You do not have permission to view financial performance.</div></main>;
  const currency = performance?.location.currency ?? "USD";
  const dateTime = (value: string) => new Date(value).toLocaleString([], { timeZone: performance?.location.timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  return <main className="admin-route-page series-performance-page film-performance-page">
    <Link href="/scheduling" className="back-link">← Film library</Link>
    <section className="series-performance-hero film-performance-hero">{performance?.movie.posterUrl && <img src={performance.movie.posterUrl} alt="" />}<div><p className="kicker">FILM PERFORMANCE</p><h1>{performance?.movie.title ?? "Film"}</h1>{performance && <><p className="film-performance-meta">{performance.movie.releaseYear ?? "Year unknown"} · {performance.movie.rating ?? "Not rated"} · {performance.movie.runtimeMinutes} min · {performance.movie.distributorName ?? "Distributor not set"}</p><p>{performance.movie.synopsis ?? "Programming and financial performance for this film."}</p></>}</div></section>
    <div className="series-period-switch" role="group" aria-label="Reporting period">{(["all", "30", "90", "365"] as Period[]).map((value) => <button type="button" className={period === value ? "active" : ""} onClick={() => setPeriod(value)} key={value}>{value === "all" ? "All time" : `${value} days`}</button>)}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}{loading && <p className="dashboard-empty">Loading film performance…</p>}
    {performance && <>
      <section className="series-performance-metrics film-performance-metrics"><div><span>Performances</span><strong>{performance.totals.showtimes}</strong><small>{performance.totals.averageShowtimesPerWeek} per week</small></div><div><span>Tickets sold</span><strong>{performance.totals.ticketsSold}</strong><small>{performance.totals.averageTicketsPerShow} average per show</small></div><div><span>Attendance</span><strong>{performance.totals.attendancePercent}%</strong><small>{performance.totals.ticketsSold} / {performance.totals.totalCapacity} seats</small></div><div><span>Ticket face value</span><strong>{money(performance.totals.ticketRevenueCents, currency)}</strong><small>{money(performance.totals.averageTicketCents, currency)} average ticket</small></div><div><span>F&amp;B revenue</span><strong>{money(performance.totals.fnbRevenueCents, currency)}</strong><small>{money(performance.totals.averageFnbPerShowCents, currency)} per show · {money(performance.totals.averageFnbPerTicketCents, currency)} per ticket</small></div><div><span>Cinema film share</span><strong>{money(performance.totals.cinemaRevenueCents, currency)}</strong><small>{money(performance.totals.distributorRevenueCents, currency)} distributor</small></div><div><span>Programming</span><strong>{performance.totals.upcomingShowtimes} upcoming</strong><small>{performance.totals.pastShowtimes} past</small></div><div><span>First showing</span><strong>{performance.totals.firstShowtime ? dateTime(performance.totals.firstShowtime) : "—"}</strong><small>{performance.totals.lastShowtime ? `Last: ${dateTime(performance.totals.lastShowtime)}` : "No showtimes"}</small></div><div><span>Film series</span><strong>{performance.series.length}</strong><small>{performance.series.map((series) => series.name).join(", ") || "Regular engagement"}</small></div></section>
      <section className="panel film-weekly-performance"><div className="dashboard-section-heading"><div><p className="kicker">WEEKLY TREND</p><h2>Performance by theatrical week</h2></div></div><div className="film-week-table"><header><span>Week / dates</span><span>Shows</span><span>Tickets / attendance</span><span>Ticket revenue</span><span>F&amp;B / average</span><span>Cinema / distributor</span></header>{performance.weeklyPerformance.map((week) => <article key={week.theatricalWeek}><span><strong>Week {week.theatricalWeek}</strong><small>{dateTime(week.firstShowtime)} – {dateTime(week.lastShowtime)}</small></span><span>{week.showtimes}<small>{week.averageTicketsPerShow} avg tickets</small></span><span>{week.ticketsSold}<small>{week.attendancePercent}% of {week.capacity}</small></span><span>{money(week.ticketRevenueCents, currency)}</span><span>{money(week.fnbRevenueCents, currency)}<small>{money(week.averageFnbPerShowCents, currency)} per show</small></span><span>{money(week.cinemaRevenueCents, currency)}<small>{money(week.distributorRevenueCents, currency)} distributor</small></span></article>)}</div></section>
      <section className="film-sales-mix"><div className="panel"><div className="dashboard-section-heading"><div><p className="kicker">AUDIENCE MIX</p><h2>Admission types</h2></div></div><div className="film-mix-list">{performance.admissionTypes.map((type) => <div key={type.ticketTypeId}><strong>{type.name}</strong><span>{type.ticketsSold} tickets</span><b>{money(type.ticketRevenueCents, currency)}</b></div>)}{performance.admissionTypes.length === 0 && <p className="dashboard-empty">No admission sales in this period.</p>}</div></div><div className="panel"><div className="dashboard-section-heading"><div><p className="kicker">SALES MIX</p><h2>Sales channels</h2></div></div><div className="film-mix-list">{performance.salesChannels.map((channel) => <div key={channel.channel}><strong>{channel.channel === "BOX_OFFICE" ? "Box office" : "Online"}</strong><span>{channel.ticketsSold} tickets</span><b>{money(channel.ticketRevenueCents, currency)}</b></div>)}{performance.salesChannels.length === 0 && <p className="dashboard-empty">No channel sales in this period.</p>}</div></div></section>
      <section className="panel film-adjustments"><div className="dashboard-section-heading"><div><p className="kicker">ADJUSTMENTS</p><h2>Promotions, comps &amp; refunds</h2></div><span>{money(performance.totals.discountCents, currency)} discounts</span></div><div className="film-adjustment-summary"><div><span>Complimentary tickets</span><strong>{performance.totals.complimentaryTickets}</strong></div><div><span>Refunded tickets</span><strong>{performance.totals.refundedTickets}</strong><small>{money(performance.totals.refundedTicketValueCents, currency)} ticket value</small></div><div><span>Promotion discount</span><strong>{money(performance.totals.discountCents, currency)}</strong></div></div><div className="film-mix-list">{performance.promotions.map((promotion) => <div key={promotion.promotionId}><strong>{promotion.code} · {promotion.name}</strong><span>{promotion.tickets} tickets · {promotion.orders} orders</span><b>−{money(promotion.discountCents, currency)}</b></div>)}{performance.promotions.length === 0 && <p className="dashboard-empty">No promotions used in this period.</p>}</div></section>
      <section className="film-performance-slices"><PerformanceBreakdown title="Performance by auditorium" kicker="ROOM COMPARISON" rows={performance.auditoriumPerformance} currency={currency} /><PerformanceBreakdown title="Performance by daypart" kicker="TIME COMPARISON" rows={performance.daypartPerformance} currency={currency} /></section>
      <section className="panel series-showtime-performance"><div className="dashboard-section-heading"><div><p className="kicker">PERFORMANCE LOG</p><h2>Every showtime</h2></div></div><div className="series-showtime-table film-showtime-table"><header><span>Date</span><span>Room / series</span><span>Sold / capacity</span><span>Tickets</span><span>F&amp;B</span><span>Cinema / distributor</span></header>{performance.showtimes.map((showtime) => <div className="film-showtime-entry" key={showtime.showtimeId}><article><span><strong>{dateTime(showtime.startsAt)}</strong><small>{showtime.theatricalWeek ? `Theatrical week ${showtime.theatricalWeek}` : "Terms needed"}</small></span><span>{showtime.auditorium.name}<small>{showtime.filmSeries?.name ?? "Regular engagement"}</small></span><span>{showtime.ticketsSold} / {showtime.capacity}</span><span>{money(showtime.ticketRevenueCents, currency)}</span><span>{money(showtime.fnbRevenueCents, currency)}</span><span>{showtime.distributorShareBasisPoints === null ? "Terms needed" : `${money(showtime.cinemaRevenueCents, currency)} / ${money(showtime.distributorRevenueCents, currency)}`}<ShowtimeTicketMap showtimeId={showtime.showtimeId} accessToken={accessToken} /></span></article></div>)}</div></section>
    </>}
  </main>;
}

function PerformanceBreakdown({ title, kicker, rows, currency }: { title: string; kicker: string; rows: PerformanceSlice[]; currency: string }) {
  return <section className="panel"><div className="dashboard-section-heading"><div><p className="kicker">{kicker}</p><h2>{title}</h2></div></div><div className="film-slice-list">{rows.map((row) => <article key={row.key}><div><strong>{row.label}</strong><small>{row.showtimes} shows · {row.averageTicketsPerShow} avg tickets</small></div><div><span>{row.ticketsSold} tickets</span><small>{row.attendancePercent}% attendance</small></div><div><span>{money(row.ticketRevenueCents, currency)}</span><small>{money(row.averageTicketRevenuePerShowCents, currency)} per show</small></div><div><span>{money(row.fnbRevenueCents, currency)} F&amp;B</span><small>{money(row.averageFnbPerShowCents, currency)} per show</small></div></article>)}{rows.length === 0 && <p className="dashboard-empty">No performance in this period.</p>}</div></section>;
}
