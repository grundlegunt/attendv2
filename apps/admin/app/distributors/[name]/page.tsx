"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../../lib/api-client";

type Film = {
  movieId: string;
  title: string;
  posterUrl: string | null;
  active: boolean;
  dealStatus: "CURRENT" | "UPCOMING" | "PAST" | "UNSCHEDULED";
  terms: Array<{
    startWeek?: number;
    endWeek?: number | null;
    distributorShareBasisPoints?: number;
  }>;
  showtimes: number;
  upcomingShowtimes: number;
  pastShowtimes: number;
  ticketsSold: number;
  totalCapacity: number;
  attendancePercent: number;
  ticketRevenueCents: number;
  fnbRevenueCents: number;
  distributorRevenueCents: number;
  cinemaRevenueCents: number;
  unallocatedRevenueCents: number;
  firstShowtime: string | null;
  lastShowtime: string | null;
};
type Distributor = {
  name: string;
  films: Film[];
  showtimes: number;
  upcomingShowtimes: number;
  pastShowtimes: number;
  ticketsSold: number;
  totalCapacity: number;
  attendancePercent: number;
  ticketRevenueCents: number;
  fnbRevenueCents: number;
  distributorRevenueCents: number;
  cinemaRevenueCents: number;
  unallocatedRevenueCents: number;
};
type Report = {
  location: { name: string; timezone: string; currency: string };
  distributor: Distributor;
};
type Period = "all" | "30" | "90" | "365";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const average = (total: number, count: number) => (count ? Math.round((total / count) * 10) / 10 : 0);
const percentage = (basisPoints: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(basisPoints / 100);

export default function DistributorPage() {
  const { name } = useParams<{ name: string }>();
  const { accessToken, employee } = useAdminSession();
  const [period, setPeriod] = useState<Period>("all");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const path = useMemo(() => {
    const base = `/reports/distributors/${encodeURIComponent(name)}`;
    if (period === "all") return base;
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 86_400_000);
    return `${base}?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [name, period]);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<Report>(path, { accessToken })
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Distributor performance could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, path]);
  if (!employee.permissions.includes("reports.view.financial"))
    return (
      <main className="admin-route-page">
        <div className="error-banner">You do not have permission to view distributor performance.</div>
      </main>
    );
  const distributor = report?.distributor;
  const currency = report?.location.currency ?? "USD";
  const dealCounts = distributor?.films.reduce(
    (counts, film) => ({
      ...counts,
      [film.dealStatus]: counts[film.dealStatus] + 1,
    }),
    { CURRENT: 0, UPCOMING: 0, PAST: 0, UNSCHEDULED: 0 },
  ) ?? { CURRENT: 0, UPCOMING: 0, PAST: 0, UNSCHEDULED: 0 };
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString([], {
          timeZone: report?.location.timezone,
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
  async function exportCsv() {
    if (!distributor || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
      const blob = await apiDownload(`/reports/distributors/${encodeURIComponent(name)}/performance.csv${query}`, { accessToken });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${
        distributor.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "distributor"
      }-performance.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "The distributor performance export could not be downloaded.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <main className="admin-route-page series-performance-page distributor-detail-page">
      <Link href="/distributors" className="back-link">
        ← All distributors
      </Link>
      <section className="series-performance-hero">
        <div>
          <p className="kicker">DISTRIBUTOR PERFORMANCE</p>
          <h1>{distributor?.name ?? name}</h1>
          <p>Film performance, box-office allocation, cinema share, and every current, upcoming, past, or unscheduled deal.</p>
          {distributor && (
            <button type="button" className="secondary film-performance-export" disabled={exporting} onClick={() => void exportCsv()}>
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          )}
        </div>
      </section>
      <div className="series-period-switch">
        {(["all", "30", "90", "365"] as Period[]).map((value) => (
          <button type="button" className={period === value ? "active" : ""} onClick={() => setPeriod(value)} key={value}>
            {value === "all" ? "All time" : `${value} days`}
          </button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!distributor && !error && <p className="dashboard-empty">Loading distributor performance…</p>}
      {distributor && (
        <>
          <section className="series-performance-metrics">
            <div>
              <span>Films</span>
              <strong>{distributor.films.length}</strong>
              <small>
                {dealCounts.CURRENT} current · {dealCounts.UPCOMING} upcoming
              </small>
            </div>
            <div>
              <span>Performances</span>
              <strong>{distributor.showtimes}</strong>
              <small>{average(distributor.ticketsSold, distributor.showtimes)} average tickets</small>
            </div>
            <div>
              <span>Tickets sold</span>
              <strong>{distributor.ticketsSold}</strong>
              <small>{money(distributor.ticketsSold ? Math.round(distributor.ticketRevenueCents / distributor.ticketsSold) : 0, currency)} average ticket</small>
            </div>
            <div>
              <span>Attendance</span>
              <strong>{distributor.attendancePercent}%</strong>
              <small>{distributor.ticketsSold} / {distributor.totalCapacity} seats</small>
            </div>
            <div>
              <span>Ticket face value</span>
              <strong>{money(distributor.ticketRevenueCents, currency)}</strong>
              <small>{money(distributor.showtimes ? Math.round(distributor.ticketRevenueCents / distributor.showtimes) : 0, currency)} per show</small>
            </div>
            <div>
              <span>F&amp;B revenue</span>
              <strong>{money(distributor.fnbRevenueCents, currency)}</strong>
              <small>{money(distributor.showtimes ? Math.round(distributor.fnbRevenueCents / distributor.showtimes) : 0, currency)} per show</small>
            </div>
            <div>
              <span>Distributor share</span>
              <strong>{money(distributor.distributorRevenueCents, currency)}</strong>
              <small>Calculated from deal terms</small>
            </div>
            <div>
              <span>Cinema share</span>
              <strong>{money(distributor.cinemaRevenueCents, currency)}</strong>
              <small>Film rental net</small>
            </div>
            <div>
              <span>Needs terms</span>
              <strong>{money(distributor.unallocatedRevenueCents, currency)}</strong>
              <small>{dealCounts.UNSCHEDULED} unscheduled films</small>
            </div>
            <div>
              <span>Upcoming performances</span>
              <strong>{distributor.upcomingShowtimes}</strong>
              <small>Still on the calendar</small>
            </div>
            <div>
              <span>Past performances</span>
              <strong>{distributor.pastShowtimes}</strong>
              <small>Completed screenings</small>
            </div>
            <div>
              <span>F&amp;B per attendee</span>
              <strong>{money(distributor.ticketsSold ? Math.round(distributor.fnbRevenueCents / distributor.ticketsSold) : 0, currency)}</strong>
              <small>Average across sold tickets</small>
            </div>
          </section>
          <section className="panel distributor-deals">
            <div className="dashboard-section-heading">
              <div>
                <p className="kicker">DEALS &amp; FILMS</p>
                <h2>Complete film history</h2>
              </div>
              <span>
                {dealCounts.CURRENT} current · {dealCounts.UPCOMING} upcoming · {dealCounts.PAST} past
              </span>
            </div>
            <div className="distributor-film-table">
              <header>
                <span>Film / deal</span>
                <span>Status</span>
                <span>Dates</span>
                <span>Shows / tickets</span>
                <span>Ticket / F&amp;B</span>
                <span>Distributor / cinema</span>
              </header>
              {distributor.films.map((film) => (
                <article key={film.movieId}>
                  <span>
                    <Link href={`/films/${encodeURIComponent(film.movieId)}`}>{film.title}</Link>
                    <small>{film.terms.length ? film.terms.map((term) => `W${term.startWeek ?? "?"}${term.endWeek ? `–${term.endWeek}` : "+"}: ${percentage(term.distributorShareBasisPoints ?? 0)}%`).join(" · ") : "Deal terms not set"}</small>
                  </span>
                  <b className={`deal-status ${film.dealStatus.toLowerCase()}`}>{film.dealStatus.toLowerCase()}</b>
                  <span>
                    {date(film.firstShowtime)}
                    <small>to {date(film.lastShowtime)}</small>
                  </span>
                  <span>
                    {film.showtimes} shows
                    <small>
                      {film.ticketsSold} tickets · {average(film.ticketsSold, film.showtimes)} average
                    </small>
                  </span>
                  <span>
                    {money(film.ticketRevenueCents, currency)}
                    <small>
                      {money(film.fnbRevenueCents, currency)} F&amp;B · {money(film.showtimes ? Math.round(film.fnbRevenueCents / film.showtimes) : 0, currency)} per show
                    </small>
                  </span>
                  <span>
                    {money(film.distributorRevenueCents, currency)}
                    <small>{money(film.cinemaRevenueCents, currency)} cinema</small>
                  </span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
