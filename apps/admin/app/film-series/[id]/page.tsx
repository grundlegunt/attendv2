"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../../admin-session";
import { apiFetch, ApiRequestError } from "../../lib/api-client";

type Performance = {
  series: { id: string; name: string; description: string | null; artworkUrl: string | null; active: boolean };
  location: { name: string; timezone: string; currency: string };
  totals: { showtimes: number; upcomingShowtimes: number; pastShowtimes: number; uniqueFilms: number; ticketsSold: number; averageTicketsPerShow: number; ticketRevenueCents: number; fnbRevenueCents: number; averageFnbPerShowCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number; firstShowtime: string | null; lastShowtime: string | null; calendarWeeks: number; averageShowtimesPerWeek: number };
  movies: Array<{ movieId: string; title: string; posterUrl: string | null; distributorName: string | null; showtimes: number; ticketsSold: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; startsAt: string; auditorium: { id: string; name: string; capacity: number }; movie: { id: string; title: string }; ticketsSold: number; capacity: number; ticketRevenueCents: number; fnbRevenueCents: number; theatricalWeek: number | null; distributorShareBasisPoints: number | null; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number }>;
};
type Period = "all" | "30" | "90" | "365";

function money(cents: number, currency = "USD") { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }

export default function FilmSeriesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, employee } = useAdminSession();
  const [period, setPeriod] = useState<Period>("all");
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const path = useMemo(() => {
    if (period === "all") return `/reports/film-series/${id}`;
    const to = new Date(); const from = new Date(to.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    return `/reports/film-series/${id}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [id, period]);

  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    apiFetch<Performance>(path, { accessToken }).then((result) => { if (!cancelled) setPerformance(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Series performance could not be loaded."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, path]);

  const currency = performance?.location.currency ?? "USD";
  const timezone = performance?.location.timezone;
  const dateTime = (value: string) => new Date(value).toLocaleString([], { timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const now = Date.now();
  const upcomingMovies = new Set(performance?.showtimes.filter((showtime) => new Date(showtime.startsAt).getTime() >= now).map((showtime) => showtime.movie.id));
  const pastMovies = new Set(performance?.showtimes.filter((showtime) => new Date(showtime.startsAt).getTime() < now).map((showtime) => showtime.movie.id));

  if (!employee.permissions.includes("reports.view.financial")) return <main className="admin-route-page"><div className="error-banner" role="alert">You do not have permission to view financial performance.</div></main>;

  return <main className="admin-route-page series-performance-page">
    <Link href="/film-series" className="back-link">← All film series</Link>
    <section className="series-performance-hero">{performance?.series.artworkUrl && <img src={performance.series.artworkUrl} alt="" />}<div><p className="kicker">FILM SERIES PERFORMANCE</p><h1>{performance?.series.name ?? "Film series"}</h1><p>{performance?.series.description ?? "Programming and financial performance across this series."}</p></div></section>
    <div className="series-period-switch" role="group" aria-label="Reporting period">{(["all", "30", "90", "365"] as Period[]).map((value) => <button type="button" className={period === value ? "active" : ""} onClick={() => setPeriod(value)} key={value}>{value === "all" ? "All time" : `${value} days`}</button>)}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}{loading && <p className="dashboard-empty">Loading series performance…</p>}
    {performance && <>
      <section className="series-performance-metrics"><div><span>Performances</span><strong>{performance.totals.showtimes}</strong><small>{performance.totals.averageShowtimesPerWeek} per week</small></div><div><span>Tickets sold</span><strong>{performance.totals.ticketsSold}</strong><small>{performance.totals.averageTicketsPerShow} average per show</small></div><div><span>Ticket face value</span><strong>{money(performance.totals.ticketRevenueCents, currency)}</strong><small>{money(performance.totals.cinemaRevenueCents, currency)} cinema share</small></div><div><span>F&amp;B revenue</span><strong>{money(performance.totals.fnbRevenueCents, currency)}</strong><small>{money(performance.totals.averageFnbPerShowCents, currency)} average per show</small></div><div><span>Distributor share</span><strong>{money(performance.totals.distributorRevenueCents, currency)}</strong><small>{performance.totals.unallocatedRevenueCents ? `${money(performance.totals.unallocatedRevenueCents, currency)} needs terms` : "Fully allocated"}</small></div><div><span>Program</span><strong>{performance.totals.uniqueFilms} films</strong><small>{performance.totals.upcomingShowtimes} upcoming · {performance.totals.pastShowtimes} past</small></div></section>
      <section className="panel series-film-performance"><div className="dashboard-section-heading"><div><p className="kicker">FILMS</p><h2>Film performance</h2></div><span>{upcomingMovies.size} upcoming · {pastMovies.size} past</span></div><div className="series-film-table"><header><span>Film</span><span>Shows</span><span>Tickets</span><span>Ticket revenue</span><span>F&amp;B</span><span>Cinema / distributor</span></header>{performance.movies.map((movie) => <article key={movie.movieId}>{movie.posterUrl ? <img src={movie.posterUrl} alt="" /> : <i>Film</i>}<span><strong>{movie.title}</strong><small>{movie.distributorName ?? "Distributor not set"}</small></span><b>{movie.showtimes}</b><b>{movie.ticketsSold}</b><b>{money(movie.ticketRevenueCents, currency)}</b><b>{money(movie.fnbRevenueCents, currency)}</b><b>{money(movie.cinemaRevenueCents, currency)} / {money(movie.distributorRevenueCents, currency)}</b></article>)}</div></section>
      <section className="panel series-showtime-performance"><div className="dashboard-section-heading"><div><p className="kicker">PERFORMANCE LOG</p><h2>Every showtime</h2></div></div><div className="series-showtime-table"><header><span>Date and film</span><span>Room</span><span>Sold / capacity</span><span>Tickets</span><span>F&amp;B</span><span>Film split</span></header>{performance.showtimes.map((showtime) => <article key={showtime.showtimeId}><span><strong>{showtime.movie.title}</strong><small>{dateTime(showtime.startsAt)}</small></span><span>{showtime.auditorium.name}</span><span>{showtime.ticketsSold} / {showtime.capacity}</span><span>{money(showtime.ticketRevenueCents, currency)}</span><span>{money(showtime.fnbRevenueCents, currency)}</span><span>{showtime.distributorShareBasisPoints === null ? "Terms needed" : `${money(showtime.cinemaRevenueCents, currency)} / ${money(showtime.distributorRevenueCents, currency)}`}</span></article>)}</div></section>
    </>}
  </main>;
}
