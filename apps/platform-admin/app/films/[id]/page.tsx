"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SeatMap, type SeatMapSeat, type SeatMapSeatingStyle } from "@cinema/ui";
import { CompanySignIn } from "../../company-sign-in";
import {
  platformDownload,
  platformRequest,
  readPlatformSession,
  revokePlatformSession,
} from "../../platform-session";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const STORAGE_KEY = "attend-platform-session";
type RangeKey = "30" | "90" | "all";
interface Session {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: "OWNER" | "OPERATOR" | "VIEWER";
  };
}
interface Totals {
  showtimes: number;
  upcomingShowtimes: number;
  pastShowtimes: number;
  ticketsSold: number;
  totalCapacity: number;
  attendancePercent: number;
  averageTicketsPerShow: number;
  ticketRevenueCents: number;
  fnbRevenueCents: number;
  averageFnbPerShowCents: number;
  averageFnbPerTicketCents: number;
  distributorRevenueCents: number;
  cinemaRevenueCents: number;
  unallocatedRevenueCents: number;
  discountCents: number;
  complimentaryTickets: number;
  refundedTickets: number;
  refundedTicketValueCents: number;
}
interface Performance {
  film: {
    id: string;
    title: string;
    synopsis: string | null;
    runtimeMinutes: number;
    rating: string | null;
    releaseYear: number | null;
    director: string | null;
    starring: string | null;
    posterUrl: string | null;
    primaryDistributorName: string | null;
    imdbId: string | null;
    tmdbId: number | null;
    eidrId: string | null;
    verified: boolean;
    active: boolean;
  };
  range: { from: string; to: string } | null;
  totals: Totals;
  weeklyPerformance: Array<{
    theatricalWeek: number;
    firstShowtime: string;
    lastShowtime: string;
    showtimes: number;
    ticketsSold: number;
    capacity: number;
    attendancePercent: number;
    averageTicketsPerShow: number;
    ticketRevenueCents: number;
    fnbRevenueCents: number;
    averageFnbPerShowCents: number;
    distributorRevenueCents: number;
    cinemaRevenueCents: number;
    unallocatedRevenueCents: number;
  }>;
  daypartPerformance: ProgrammingSlice[];
  weekdayPerformance: ProgrammingSlice[];
  admissionTypes: Array<{ name: string; ticketsSold: number; ticketRevenueCents: number; percentOfTickets: number }>;
  salesChannels: Array<{ channel: string; ticketsSold: number; ticketRevenueCents: number; percentOfTickets: number }>;
  advanceSales: Array<{ key: string; label: string; ticketsSold: number; ticketRevenueCents: number; percentOfTickets: number; averageLeadHours: number }>;
  promotions: Array<{ code: string; name: string; type: string; orders: number; tickets: number; discountCents: number }>;
  fnbItems: Array<{ name: string; chargeCategory: string; unitsSold: number; salesCents: number; orderAheadUnits: number; serviceUnits: number }>;
  showtimePerformance: Array<{
    organization: { id: string; name: string };
    location: { id: string; name: string };
    localMovieId: string;
    showtimeId: string;
    startsAt: string;
    auditorium: { id: string; name: string; capacity: number };
    filmSeries: { id: string; name: string } | null;
    theatricalWeek: number | null;
    ticketsSold: number;
    capacity: number;
    attendancePercent: number;
    ticketRevenueCents: number;
    fnbRevenueCents: number;
    distributorRevenueCents: number;
    cinemaRevenueCents: number;
    unallocatedRevenueCents: number;
  }>;
  operators: Array<{
    organization: { id: string; name: string };
    location: { id: string; name: string };
    localMovieId: string;
    totals: Totals;
  }>;
  audienceOrigins: {
    totals: { completedOrders: number; ordersWithZip: number; ticketsWithZip: number; coveragePercent: number };
    origins: Array<{ zipCode: string; orders: number; tickets: number; sharePercent: number }>;
  };
  customerSegments: Array<{ key: string; label: string; orders: number; ticketsSold: number; ticketRevenueCents: number; percentOfTickets: number }>;
}
interface ProgrammingSlice {
  key: string;
  label: string;
  showtimes: number;
  ticketsSold: number;
  capacity: number;
  attendancePercent: number;
  averageTicketsPerShow: number;
  ticketRevenueCents: number;
  averageTicketRevenuePerShowCents: number;
  fnbRevenueCents: number;
  averageFnbPerShowCents: number;
}
interface TicketMap {
  showtime: { id: string; currency: string; seatingStyle: SeatMapSeatingStyle };
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED"; ticket: { id: string; priceCentsPaid: number; ticketType: { name: string }; ticketOrder: { orderNumber: string; channel: string } } | null }>;
  counts: { available: number; held: number; sold: number; blocked: number };
}

function request<T>(
  path: string,
  init?: RequestInit,
  accessToken?: string,
): Promise<T> {
  return platformRequest<T>(API_BASE_URL, STORAGE_KEY, path, init, accessToken);
}
function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
function rangeQuery(range: RangeKey) {
  if (range === "all") return "";
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - Number(range));
  return `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}
function bestOperator(
  operators: Performance["operators"],
  value: (operator: Performance["operators"][number]) => number,
) {
  return operators.reduce<Performance["operators"][number] | null>(
    (best, operator) => (!best || value(operator) > value(best) ? operator : best),
    null,
  );
}

export default function FilmPerformancePage() {
  const params = useParams<{ id: string }>();
  const filmId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [session, setSession] = useState<Session | null>(null);
  const [restored, setRestored] = useState(false);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [range, setRange] = useState<RangeKey>("90");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ticketMap, setTicketMap] = useState<TicketMap | null>(null);
  const [ticketMapShowtimeId, setTicketMapShowtimeId] = useState<string | null>(null);
  const [ticketMapLoading, setTicketMapLoading] = useState(false);
  const requestRef = useRef(0);
  const authRequestRef = useRef(0);
  useEffect(() => {
    setSession(readPlatformSession(STORAGE_KEY));
    setRestored(true);
  }, []);
  const load = useCallback(
    async (current: Session, selectedRange: RangeKey) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await request<Performance>(
          `/platform/film-catalog/${encodeURIComponent(filmId)}/performance${rangeQuery(selectedRange)}`,
          undefined,
          current.accessToken,
        );
        if (requestId === requestRef.current) setPerformance(result);
      } catch (reason) {
        if (requestId === requestRef.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load film performance.",
          );
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [filmId],
  );
  useEffect(() => {
    if (session && filmId) void load(session, range);
  }, [session, filmId, range, load]);
  async function login(event: FormEvent) {
    event.preventDefault();
    const requestId = ++authRequestRef.current;
    setError(null);
    try {
      const result = await request<Session>("/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (requestId !== authRequestRef.current) return;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setSession(result);
      setPassword("");
    } catch (reason) {
      if (requestId === authRequestRef.current)
        setError(reason instanceof Error ? reason.message : "Sign in failed.");
    }
  }
  function signOut() {
    authRequestRef.current += 1;
    requestRef.current += 1;
    void revokePlatformSession(API_BASE_URL, session?.accessToken);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setPerformance(null);
    setError(null);
  }
  async function downloadPerformance() {
    if (!session || !filmId) return;
    setExporting(true);
    setError(null);
    try {
      const blob = await platformDownload(
        API_BASE_URL,
        STORAGE_KEY,
        `/platform/film-catalog/${encodeURIComponent(filmId)}/performance.csv${rangeQuery(range)}`,
        session.accessToken,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ringo-master-film-performance.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export film performance.");
    } finally {
      setExporting(false);
    }
  }
  async function toggleTicketMap(showtimeId: string) {
    if (ticketMapShowtimeId === showtimeId) {
      setTicketMapShowtimeId(null);
      setTicketMap(null);
      return;
    }
    if (!session) return;
    setTicketMapShowtimeId(showtimeId);
    setTicketMap(null);
    setTicketMapLoading(true);
    setError(null);
    try {
      setTicketMap(await request<TicketMap>(`/platform/showtimes/${encodeURIComponent(showtimeId)}/ticket-map`, undefined, session.accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the ticket map.");
    } finally {
      setTicketMapLoading(false);
    }
  }
  if (!restored)
    return (
      <main className="center">
        <p>Loading Ringo Master…</p>
      </main>
    );
  if (!session)
    return (
      <CompanySignIn
        email={email}
        password={password}
        error={error}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={login}
      />
    );
  const totals = performance?.totals;
  const operatorBenchmarks = performance
    ? [
        {
          label: "Best attendance",
          operator: bestOperator(performance.operators, (row) => row.totals.attendancePercent),
          value: (row: Performance["operators"][number]) => `${row.totals.attendancePercent}%`,
        },
        {
          label: "Most tickets / show",
          operator: bestOperator(performance.operators, (row) => row.totals.averageTicketsPerShow),
          value: (row: Performance["operators"][number]) => `${row.totals.averageTicketsPerShow}`,
        },
        {
          label: "Best ticket revenue / show",
          operator: bestOperator(performance.operators, (row) => row.totals.showtimes ? row.totals.ticketRevenueCents / row.totals.showtimes : 0),
          value: (row: Performance["operators"][number]) => money(row.totals.showtimes ? Math.round(row.totals.ticketRevenueCents / row.totals.showtimes) : 0),
        },
        {
          label: "Best F&B / attendee",
          operator: bestOperator(performance.operators, (row) => row.totals.ticketsSold ? row.totals.fnbRevenueCents / row.totals.ticketsSold : 0),
          value: (row: Performance["operators"][number]) => money(row.totals.ticketsSold ? Math.round(row.totals.fnbRevenueCents / row.totals.ticketsSold) : 0),
        },
      ]
    : [];
  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">FILM INTELLIGENCE</p>
          <h1>{performance?.film.title ?? "Film performance"}</h1>
          <p className="muted">
            Cross-operator theatrical performance from the shared Ringo
            catalog.
          </p>
        </div>
        <div className="identity">
          <span>{session.user.name}</span>
          <button className="quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="platform-nav" aria-label="Ringo Master">
        <Link href="/">Dashboard</Link>
        <Link href="/clients">Clients</Link>
        <Link className="active" href="/films">
          Films
        </Link>
        <Link href="/distributors">Distributors</Link>
        <Link href="/analytics">Audience</Link>
        <Link href="/onboarding">Onboarding</Link>
        <Link href="/payments">Payments</Link>
        <Link href="/content">Content</Link>
        <Link href="/branding">Branding</Link>
        {session.user.role === "OWNER" && <Link href="/team">Team</Link>}
        <Link href="/audit">Audit Log</Link>
      </nav>
      <div className="film-intelligence-heading">
        <Link className="back" href="/films">
          ← Film catalog
        </Link>
        <div className="performance-range" aria-label="Performance range">
          {(["30", "90", "all"] as RangeKey[]).map((value) => (
            <button
              type="button"
              className={range === value ? "quiet active" : "quiet"}
              key={value}
              onClick={() => setRange(value)}
            >
              {value === "all" ? "All time" : `${value} days`}
            </button>
          ))}
          <button type="button" className="quiet" disabled={!performance || exporting} onClick={() => void downloadPerformance()}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">Loading performance…</p>}
      {performance && totals && (
        <>
          <section className="detail-heading">
            <div>
              <p className="eyebrow">CANONICAL FILM</p>
              <h2>{performance.film.title}</h2>
              <p className="muted">
                {[
                  performance.film.releaseYear,
                  `${performance.film.runtimeMinutes} min`,
                  performance.film.rating,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p>{performance.film.synopsis}</p>
            </div>
            <dl>
              <div>
                <dt>Distributor</dt>
                <dd>{performance.film.primaryDistributorName ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Director</dt>
                <dd>{performance.film.director ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Operator locations</dt>
                <dd>{performance.operators.length}</dd>
              </div>
            </dl>
          </section>
          <section className="film-intelligence-metrics">
            <article>
              <span>Shows</span>
              <strong>{totals.showtimes}</strong>
              <small>
                {totals.upcomingShowtimes} upcoming · {totals.pastShowtimes}{" "}
                past
              </small>
            </article>
            <article>
              <span>Tickets sold</span>
              <strong>{totals.ticketsSold}</strong>
              <small>{totals.averageTicketsPerShow} average per show</small>
            </article>
            <article>
              <span>Attendance</span>
              <strong>{totals.attendancePercent}%</strong>
              <small>{totals.totalCapacity} total capacity</small>
            </article>
            <article>
              <span>Ticket revenue</span>
              <strong>{money(totals.ticketRevenueCents)}</strong>
              <small>Face value</small>
            </article>
            <article>
              <span>F&amp;B revenue</span>
              <strong>{money(totals.fnbRevenueCents)}</strong>
              <small>
                {money(totals.averageFnbPerShowCents)} average per show
              </small>
            </article>
            <article>
              <span>Distributor share</span>
              <strong>{money(totals.distributorRevenueCents)}</strong>
              <small>Calculated allocation</small>
            </article>
            <article>
              <span>Cinema share</span>
              <strong>{money(totals.cinemaRevenueCents)}</strong>
              <small>Calculated allocation</small>
            </article>
            <article>
              <span>Needs terms</span>
              <strong>{money(totals.unallocatedRevenueCents)}</strong>
              <small>Unallocated face value</small>
            </article>
            <article><span>Discounts</span><strong>{money(totals.discountCents)}</strong><small>Across completed ticket orders</small></article>
            <article><span>Complimentary</span><strong>{totals.complimentaryTickets}</strong><small>Tickets issued through comp promotions</small></article>
            <article><span>Refunded tickets</span><strong>{totals.refundedTickets}</strong><small>{money(totals.refundedTicketValueCents)} face value</small></article>
          </section>
          {performance.operators.length > 0 && (
            <section className="film-operator-benchmarks">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">OPERATOR BENCHMARKS</p>
                  <h2>Where this film performs best</h2>
                  <p className="muted">Compare cinema results for the selected reporting period.</p>
                </div>
              </div>
              <div>
                {operatorBenchmarks.map(({ label, operator, value }) => operator && (
                  <Link key={label} href={`/clients?organizationId=${encodeURIComponent(operator.organization.id)}&locationId=${encodeURIComponent(operator.location.id)}`}>
                    <span>{label}</span>
                    <strong>{value(operator)}</strong>
                    <small>{operator.organization.name} · {operator.location.name}</small>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="film-operator-table">
            <div>
              <span>Operator / location</span>
              <span>Shows</span>
              <span>Tickets</span>
              <span>Attendance</span>
              <span>Ticket revenue</span>
              <span>F&amp;B</span>
              <span>Distributor</span>
              <span>Cinema</span>
            </div>
            {performance.operators.map((row) => (
              <article key={`${row.organization.id}:${row.location.id}`}>
                <strong>
                  {row.organization.name}
                  <small>{row.location.name}</small>
                </strong>
                <span>{row.totals.showtimes}</span>
                <span>{row.totals.ticketsSold}</span>
                <span>{row.totals.attendancePercent}%</span>
                <span>{money(row.totals.ticketRevenueCents)}</span>
                <span>{money(row.totals.fnbRevenueCents)}</span>
                <span>{money(row.totals.distributorRevenueCents)}</span>
                <span>{money(row.totals.cinemaRevenueCents)}</span>
              </article>
            ))}
            {performance.operators.length === 0 && (
              <p className="empty-state">
                No operator has imported this film yet.
              </p>
            )}
          </section>
          <section className="film-showtime-performance">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PERFORMANCE DETAIL</p>
                <h2>Individual showtimes</h2>
                <p className="muted">The 100 most recent performances in this period. Export CSV includes every row.</p>
              </div>
            </div>
            {performance.showtimePerformance.length === 0 ? <p className="empty-state">No scheduled performances in this period.</p> : (
              <div className="film-showtime-table">
                <div><span>Date &amp; time</span><span>Operator / location</span><span>Room</span><span>Week</span><span>Tickets</span><span>Attendance</span><span>Ticket revenue</span><span>F&amp;B</span><span>Map</span></div>
                {performance.showtimePerformance.slice(0, 100).map((showtime) => (
                  <article key={showtime.showtimeId}>
                    <strong>{new Date(showtime.startsAt).toLocaleString()}</strong>
                    <Link href={`/clients?organizationId=${encodeURIComponent(showtime.organization.id)}&locationId=${encodeURIComponent(showtime.location.id)}`}>{showtime.organization.name}<small>{showtime.location.name}</small></Link>
                    <span>{showtime.auditorium.name}</span>
                    <span>{showtime.theatricalWeek ? `Week ${showtime.theatricalWeek}` : "—"}</span>
                    <span>{showtime.ticketsSold} / {showtime.capacity}</span>
                    <span>{showtime.attendancePercent}%</span>
                    <span>{money(showtime.ticketRevenueCents)}</span>
                    <span>{money(showtime.fnbRevenueCents)}</span>
                    <button type="button" className="quiet" aria-expanded={ticketMapShowtimeId === showtime.showtimeId} onClick={() => void toggleTicketMap(showtime.showtimeId)}>{ticketMapShowtimeId === showtime.showtimeId ? "Hide" : "View"}</button>
                  </article>
                ))}
              </div>
            )}
            {ticketMapShowtimeId && <div className="master-ticket-map" aria-label="Showtime ticket map">
              {ticketMapLoading && <p className="muted">Loading ticket map…</p>}
              {ticketMap && <>
                <SeatMap seats={ticketMap.seats.map((seat) => ({ ...seat, state: seat.state === "SOLD" ? "selected" : seat.state === "AVAILABLE" ? "available" : "unavailable" }))} seatingStyle={ticketMap.showtime.seatingStyle} label="Sold-seat map" />
                <div className="master-ticket-map-counts"><span>{ticketMap.counts.sold} sold</span><span>{ticketMap.counts.held} held</span><span>{ticketMap.counts.available} available</span><span>{ticketMap.counts.blocked} blocked</span></div>
                <div className="master-sold-seat-ledger">{ticketMap.seats.filter((seat) => seat.ticket).map((seat) => <div key={seat.id}><strong>{seat.label}</strong><span>{seat.ticket!.ticketType.name} · {money(seat.ticket!.priceCentsPaid)}</span><small>{seat.ticket!.ticketOrder.orderNumber} · {seat.ticket!.ticketOrder.channel.toLowerCase()}</small></div>)}</div>
              </>}
            </div>}
          </section>
          <section className="film-weekly-performance">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">WEEKLY TREND</p>
                <h2>Performance by theatrical week</h2>
                <p className="muted">Combined across every operator and location using this catalog film.</p>
              </div>
            </div>
            {performance.weeklyPerformance.length === 0 ? <p className="empty-state">No scheduled performances in this period.</p> : <div className="film-week-table">
              <div><span>Week</span><span>Dates</span><span>Shows</span><span>Tickets</span><span>Avg / show</span><span>Attendance</span><span>Ticket revenue</span><span>F&amp;B</span><span>Distributor</span><span>Cinema</span></div>
              {performance.weeklyPerformance.map((week) => <article key={week.theatricalWeek}>
                <strong>Week {week.theatricalWeek}</strong>
                <span>{new Date(week.firstShowtime).toLocaleDateString()}–{new Date(week.lastShowtime).toLocaleDateString()}</span>
                <span>{week.showtimes}</span>
                <span>{week.ticketsSold}</span>
                <span>{week.averageTicketsPerShow}</span>
                <span>{week.attendancePercent}%</span>
                <span>{money(week.ticketRevenueCents)}</span>
                <span>{money(week.fnbRevenueCents)}</span>
                <span>{money(week.distributorRevenueCents)}</span>
                <span>{money(week.cinemaRevenueCents)}</span>
              </article>)}
            </div>}
          </section>
          <section className="film-programming-insights">
            {([
              ["Performance by daypart", performance.daypartPerformance],
              ["Performance by weekday", performance.weekdayPerformance],
            ] as Array<[string, ProgrammingSlice[]]>).map(([title, rows]) => <article key={title}>
              <div className="panel-heading"><div><p className="eyebrow">PROGRAMMING MIX</p><h2>{title}</h2></div></div>
              {rows.length === 0 ? <p className="empty-state">No scheduled performances in this period.</p> : <div className="programming-slice-table">
                <div><span>Period</span><span>Shows</span><span>Tickets</span><span>Avg / show</span><span>Attendance</span><span>Ticket / show</span><span>F&amp;B / show</span></div>
                {rows.map((row) => <div key={row.key}><strong>{row.label}</strong><span>{row.showtimes}</span><span>{row.ticketsSold}</span><span>{row.averageTicketsPerShow}</span><span>{row.attendancePercent}%</span><span>{money(row.averageTicketRevenuePerShowCents)}</span><span>{money(row.averageFnbPerShowCents)}</span></div>)}
              </div>}
            </article>)}
          </section>
          <section className="film-sales-insights">
            <div className="panel-heading"><div><p className="eyebrow">AUDIENCE &amp; SALES</p><h2>How customers buy this film</h2><p className="muted">Combined ticket mix across every operator using the canonical title.</p></div></div>
            <div className="film-sales-grid">
              <article><h3>Admission types</h3>{performance.admissionTypes.length === 0 ? <p className="empty-state">No ticket sales in this period.</p> : <div className="sales-mix-list">{performance.admissionTypes.map((row) => <div key={row.name}><strong>{row.name}</strong><span>{row.ticketsSold} tickets · {row.percentOfTickets}%</span><span>{money(row.ticketRevenueCents)}</span></div>)}</div>}</article>
              <article><h3>Sales channels</h3>{performance.salesChannels.length === 0 ? <p className="empty-state">No ticket sales in this period.</p> : <div className="sales-mix-list">{performance.salesChannels.map((row) => <div key={row.channel}><strong>{row.channel === "BOX_OFFICE" ? "Box office" : "Online"}</strong><span>{row.ticketsSold} tickets · {row.percentOfTickets}%</span><span>{money(row.ticketRevenueCents)}</span></div>)}</div>}</article>
              <article><h3>Advance purchase timing</h3>{performance.advanceSales.length === 0 ? <p className="empty-state">No ticket sales in this period.</p> : <div className="sales-mix-list">{performance.advanceSales.map((row) => <div key={row.key}><strong>{row.label}</strong><span>{row.ticketsSold} tickets · {row.percentOfTickets}%</span><span>{row.averageLeadHours}h avg lead</span></div>)}</div>}</article>
            </div>
          </section>
          <section className="film-audience-origins">
            <div className="panel-heading"><div><p className="eyebrow">AUDIENCE GEOGRAPHY</p><h2>Where this film draws customers</h2><p className="muted">Aggregated five-digit ZIP data only. {performance.audienceOrigins.totals.coveragePercent}% of completed orders in this period included a valid ZIP.</p></div></div>
            {performance.audienceOrigins.origins.length === 0 ? <p className="empty-state">No ZIP-attributed ticket sales in this period.</p> : <div className="audience-origin-list">
              {performance.audienceOrigins.origins.slice(0, 20).map((origin) => <div key={origin.zipCode}><strong>{origin.zipCode}</strong><span>{origin.tickets} tickets</span><span>{origin.orders} orders</span><span>{origin.sharePercent}%</span></div>)}
            </div>}
          </section>
          <section className="film-customer-segments">
            <div className="panel-heading"><div><p className="eyebrow">LOYALTY &amp; MEMBERSHIP</p><h2>Who buys tickets for this film</h2><p className="muted">Aggregated by the customer relationship recorded by each operator. No customer identities are shared.</p></div></div>
            {performance.customerSegments.length === 0 ? <p className="empty-state">No completed ticket sales in this period.</p> : <div className="customer-segment-grid">
              {performance.customerSegments.map((segment) => <article key={segment.key}><span>{segment.label}</span><strong>{segment.ticketsSold}</strong><small>{segment.percentOfTickets}% of tickets · {segment.orders} orders · {money(segment.ticketRevenueCents)}</small></article>)}
            </div>}
          </section>
          <section className="film-commercial-insights">
            <article><div className="panel-heading"><div><p className="eyebrow">CONCESSIONS</p><h2>Top F&amp;B items</h2><p className="muted">Item sales connected to this film across operators.</p></div></div>{performance.fnbItems.length === 0 ? <p className="empty-state">No linked F&amp;B sales in this period.</p> : <div className="commercial-list">{performance.fnbItems.slice(0, 10).map((item) => <div key={`${item.chargeCategory}:${item.name}`}><strong>{item.name}<small>{item.chargeCategory.toLowerCase()} · {item.orderAheadUnits} ahead · {item.serviceUnits} in service</small></strong><span>{item.unitsSold} units</span><span>{money(item.salesCents)}</span></div>)}</div>}</article>
            <article><div className="panel-heading"><div><p className="eyebrow">PROMOTIONS</p><h2>Offer performance</h2><p className="muted">Promotions used for this film across operators.</p></div></div>{performance.promotions.length === 0 ? <p className="empty-state">No promotions were used in this period.</p> : <div className="commercial-list">{performance.promotions.map((promotion) => <div key={promotion.code}><strong>{promotion.code}<small>{promotion.name} · {promotion.type.toLowerCase()}</small></strong><span>{promotion.tickets} tickets</span><span>{money(promotion.discountCents)}</span></div>)}</div>}</article>
          </section>
          <p className="detail-note">
            Ringo Master shows calculated performance allocations. Each
            operator&apos;s underlying deal schedules and private terms remain
            private.
          </p>
        </>
      )}
    </main>
  );
}
