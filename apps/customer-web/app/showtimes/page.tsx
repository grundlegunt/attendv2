"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SeatPicker } from "../components/seat-picker";

interface NowPlayingResponse {
  location: { id: string; name: string; address: string | null; timezone: string };
  movies: NowPlayingMovie[];
}

function localDateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function ShowtimesPage() {
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const availableDates = useMemo(
    () => Array.from(new Set(
      program?.movies.flatMap((movie) => movie.showtimes.map((showtime) => localDateKey(showtime.startsAt, program.location.timezone))) ?? [],
    )).sort(),
    [program],
  );
  const activeDate = selectedDate ?? availableDates[0] ?? null;

  const moviesForActiveDate = useMemo(() => {
    if (!program || !activeDate) return [];
    return program.movies
      .map((movie) => ({
        movie,
        showtimes: movie.showtimes
          .filter((showtime) => localDateKey(showtime.startsAt, program.location.timezone) === activeDate)
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
      }))
      .filter((entry) => entry.showtimes.length > 0)
      .sort(
        (a, b) =>
          new Date(a.showtimes[0]!.startsAt).getTime() - new Date(b.showtimes[0]!.startsAt).getTime(),
      );
  }, [program, activeDate]);

  useEffect(() => {
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then(setProgram)
      .catch((err) =>
        setProgramError(err instanceof ApiRequestError ? err.body.message : "Showtimes are unavailable."),
      );
  }, []);

  return (
    <main className="cinema-shell">
      <section className="program-heading">
        <span className="eyebrow">NOW PLAYING</span>
        <h1>{program?.location.name ?? "Showtimes"}</h1>
        {program && <p>Choose a showtime and reserve your seats.</p>}
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
            {moviesForActiveDate.map(({ movie, showtimes }) => (
              <article className="movie-card" key={movie.id}>
                <div className="poster-frame">
                  {movie.posterUrl ? <img src={movie.posterUrl} alt={`${movie.title} poster`} /> : <span>{movie.title}</span>}
                </div>
                <div className="movie-copy">
                  <p className="movie-meta">{movie.rating ?? "NR"} · {movie.runtimeMinutes} MIN</p>
                  <h2>{movie.title}</h2>
                  {movie.synopsis && <p>{movie.synopsis}</p>}
                  <div className="showtime-list">
                    {showtimes.map((showtime) => {
                      const isPast = new Date(showtime.startsAt).getTime() <= Date.now();
                      return (
                        <button
                          key={showtime.id}
                          className={isPast ? "past" : undefined}
                          disabled={isPast}
                          aria-disabled={isPast}
                          onClick={() => setSelectedShowtimeId(showtime.id)}
                        >
                          <strong>{new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>
                          <span>{showtime.auditorium.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
