"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthenticatedCustomer, AuthTokenResponse, NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { SeatPicker } from "./components/seat-picker";

type Mode = "login" | "register";
interface NowPlayingResponse {
  location: { id: string; name: string; timezone: string };
  movies: NowPlayingMovie[];
}

function localDateKey(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function HomePage() {
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<AuthenticatedCustomer | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const availableDates = useMemo(
    () => Array.from(new Set(
      program?.movies.flatMap((movie) => movie.showtimes.map((showtime) => localDateKey(showtime.startsAt))) ?? [],
    )).sort(),
    [program],
  );
  const activeDate = selectedDate ?? availableDates[0] ?? null;

  useEffect(() => {
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then(setProgram)
      .catch((err) =>
        setProgramError(err instanceof ApiRequestError ? err.body.message : "Showtimes are unavailable."),
      );
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/customers/login" : "/auth/customers/register";
      const body = mode === "login" ? { email, password } : { email, password, name: name || undefined };
      const response = await apiFetch<AuthTokenResponse & { customer: AuthenticatedCustomer }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCustomer(response.customer);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="cinema-shell">
      <header className="site-header">
        <div>
          <span className="eyebrow">ATTEND</span>
          <h1>{program?.location.name ?? "Meridian Cinema"}</h1>
        </div>
        <button className="account-button" onClick={() => setAccountOpen((open) => !open)}>
          {customer ? customer.name ?? customer.email : "Account"}
        </button>
      </header>

      {accountOpen && !customer && (
        <section className="account-panel" aria-label="Customer account">
          <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleSubmit}>
            {mode === "register" && (
              <div className="field"><label htmlFor="name">Name</label><input id="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            )}
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <button className="primary" type="submit" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
          </button>
        </section>
      )}

      <section className="program-heading">
        <span className="eyebrow">NOW PLAYING</span>
        <h2>Showtimes</h2>
      </section>

      {!selectedShowtimeId && availableDates.length > 0 && (
        <nav className="date-bar" aria-label="Showtime dates">
          {availableDates.map((dateKey) => {
            const date = new Date(`${dateKey}T12:00:00`);
            return (
              <button
                key={dateKey}
                className={dateKey === activeDate ? "active" : ""}
                onClick={() => setSelectedDate(dateKey)}
              >
                <span>{date.toLocaleDateString([], { weekday: "short" })}</span>
                <strong>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
              </button>
            );
          })}
        </nav>
      )}

      {selectedShowtimeId ? (
        <SeatPicker showtimeId={selectedShowtimeId} onClose={() => setSelectedShowtimeId(null)} />
      ) : (
        <>
      {programError && <div className="error-banner">{programError}</div>}
      {!program && !programError && <p className="loading-copy">Loading the program…</p>}
      {program && program.movies.length === 0 && <p className="loading-copy">No showtimes are on sale yet.</p>}

      <section className="movie-grid">
        {program?.movies.map((movie) => {
          const showtimes = movie.showtimes.filter((showtime) => localDateKey(showtime.startsAt) === activeDate);
          if (showtimes.length === 0) return null;
          return (
          <article className="movie-card" key={movie.id}>
            <div className="poster-frame">
              {movie.posterUrl ? <img src={movie.posterUrl} alt={`${movie.title} poster`} /> : <span>{movie.title}</span>}
            </div>
            <div className="movie-copy">
              <p className="movie-meta">{movie.rating ?? "NR"} · {movie.runtimeMinutes} MIN</p>
              <h3>{movie.title}</h3>
              {movie.synopsis && <p>{movie.synopsis}</p>}
              <div className="showtime-list">
                {showtimes.map((showtime) => (
                  <button key={showtime.id} onClick={() => setSelectedShowtimeId(showtime.id)}>
                    <strong>{new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>
                    <span>{showtime.auditorium.name}</span>
                    <span>
                      ${(showtime.priceTier.ticketPriceMinor / 100).toFixed(0)}
                      {" + $"}
                      {(showtime.priceTier.feeMinor / 100).toFixed(0)} fee
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </article>
          );
        })}
      </section>
        </>
      )}
    </main>
  );
}
