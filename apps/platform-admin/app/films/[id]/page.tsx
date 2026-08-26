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
  operators: Array<{
    organization: { id: string; name: string };
    location: { id: string; name: string };
    localMovieId: string;
    totals: Totals;
  }>;
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
