"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CompanySignIn } from "../../company-sign-in";
import {
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
  operators: Array<{
    organization: { id: string; name: string };
    location: { id: string; name: string };
    localMovieId: string;
    totals: Totals;
  }>;
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
