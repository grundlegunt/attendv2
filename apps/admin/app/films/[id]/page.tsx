"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../../admin-session";
import { apiFetch, ApiRequestError } from "../../lib/api-client";

type Performance = {
  movie: { id: string; title: string; synopsis: string | null; runtimeMinutes: number; rating: string | null; posterUrl: string | null; director: string | null; starring: string | null; releaseYear: number | null; distributorName: string | null; active: boolean };
  location: { name: string; timezone: string; currency: string };
  totals: { showtimes: number; upcomingShowtimes: number; pastShowtimes: number; ticketsSold: number; totalCapacity: number; attendancePercent: number; averageTicketsPerShow: number; averageTicketCents: number; ticketRevenueCents: number; fnbRevenueCents: number; averageFnbPerShowCents: number; averageFnbPerTicketCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; firstShowtime: string | null; lastShowtime: string | null; calendarWeeks: number; averageShowtimesPerWeek: number };
  series: Array<{ id: string; name: string }>;
  showtimes: Array<{ showtimeId: string; startsAt: string; auditorium: { id: string; name: string; capacity: number }; filmSeries: { id: string; name: string } | null; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number; theatricalWeek: number | null; distributorShareBasisPoints: number | null; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>;
};
type Period = "all" | "30" | "90" | "365";

function money(cents: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }

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
      <section className="series-performance-metrics film-performance-metrics"><div><span>Performances</span><strong>{performance.totals.showtimes}</strong><small>{performance.totals.averageShowtimesPerWeek} per week</small></div><div><span>Tickets sold</span><strong>{performance.totals.ticketsSold}</strong><small>{performance.totals.averageTicketsPerShow} average per show</small></div><div><span>Attendance</span><strong>{performance.totals.attendancePercent}%</strong><small>{performance.totals.ticketsSold} / {performance.totals.totalCapacity} seats</small></div><div><span>Ticket face value</span><strong>{money(performance.totals.ticketRevenueCents, currency)}</strong><small>{money(performance.totals.averageTicketCents, currency)} average ticket</small></div><div><span>F&amp;B revenue</span><strong>{money(performance.totals.fnbRevenueCents, currency)}</strong><small>{money(performance.totals.averageFnbPerTicketCents, currency)} per ticket</small></div><div><span>Cinema film share</span><strong>{money(performance.totals.cinemaRevenueCents, currency)}</strong><small>{money(performance.totals.distributorRevenueCents, currency)} distributor</small></div><div><span>Programming</span><strong>{performance.totals.upcomingShowtimes} upcoming</strong><small>{performance.totals.pastShowtimes} past</small></div><div><span>First showing</span><strong>{performance.totals.firstShowtime ? dateTime(performance.totals.firstShowtime) : "—"}</strong><small>{performance.totals.lastShowtime ? `Last: ${dateTime(performance.totals.lastShowtime)}` : "No showtimes"}</small></div><div><span>Film series</span><strong>{performance.series.length}</strong><small>{performance.series.map((series) => series.name).join(", ") || "Regular engagement"}</small></div></section>
      <section className="panel series-showtime-performance"><div className="dashboard-section-heading"><div><p className="kicker">PERFORMANCE LOG</p><h2>Every showtime</h2></div></div><div className="series-showtime-table film-showtime-table"><header><span>Date</span><span>Room / series</span><span>Sold / capacity</span><span>Tickets</span><span>F&amp;B</span><span>Cinema / distributor</span></header>{performance.showtimes.map((showtime) => <article key={showtime.showtimeId}><span><strong>{dateTime(showtime.startsAt)}</strong><small>{showtime.theatricalWeek ? `Theatrical week ${showtime.theatricalWeek}` : "Terms needed"}</small></span><span>{showtime.auditorium.name}<small>{showtime.filmSeries?.name ?? "Regular engagement"}</small></span><span>{showtime.ticketsSold} / {showtime.capacity}</span><span>{money(showtime.ticketRevenueCents, currency)}</span><span>{money(showtime.fnbRevenueCents, currency)}</span><span>{showtime.distributorShareBasisPoints === null ? "Terms needed" : `${money(showtime.cinemaRevenueCents, currency)} / ${money(showtime.distributorRevenueCents, currency)}`}</span></article>)}</div></section>
    </>}
  </main>;
}
