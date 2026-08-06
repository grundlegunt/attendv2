"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SeatPicker } from "../components/seat-picker";
import { localDateKey, MovieTile } from "../components/movie-tile";

interface NowPlayingResponse {
  location: { id: string; name: string; address: string | null; timezone: string };
  movies: NowPlayingMovie[];
}

export default function ShowtimesPage() {
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const nowPlayingMovies = useMemo(() => {
    if (!program) return [];
    const today = localDateKey(new Date(), program.location.timezone);
    return program.movies.filter((movie) => {
      const firstDate = movie.showtimes[0] ? localDateKey(movie.showtimes[0].startsAt, program.location.timezone) : null;
      return firstDate !== null && firstDate <= today;
    });
  }, [program]);

  const availableDates = useMemo(
    () => Array.from(new Set(
      nowPlayingMovies.flatMap((movie) => movie.showtimes.map((showtime) => localDateKey(showtime.startsAt, program!.location.timezone))),
    )).sort(),
    [program, nowPlayingMovies],
  );
  const activeDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    if (!program) return availableDates[0] ?? null;
    const today = localDateKey(new Date(), program.location.timezone);
    return availableDates.includes(today)
      ? today
      : availableDates.find((date) => date > today) ?? availableDates[0] ?? null;
  }, [availableDates, program, selectedDate]);

  const moviesForActiveDate = useMemo(() => {
    if (!program || !activeDate) return [];
    return nowPlayingMovies
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
  }, [program, activeDate, nowPlayingMovies]);

  useEffect(() => {
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then(setProgram)
      .catch((err) =>
        setProgramError(err instanceof ApiRequestError ? err.body.message : "Showtimes are unavailable."),
      );
  }, []);

  return (
    <main className="cinema-shell route-page">
      <section className="program-heading">
        <span className="eyebrow">NOW PLAYING</span>
        <h1>Showtimes</h1>
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
          {program && nowPlayingMovies.length === 0 && <p className="loading-copy">No movies are playing today.</p>}

          <section className="movie-grid">
            {moviesForActiveDate.map(({ movie, showtimes }) => <MovieTile
              key={movie.id}
              movie={movie}
              showtimes={showtimes}
              timeZone={program!.location.timezone}
              onSelectShowtime={setSelectedShowtimeId}
            />)}
          </section>
        </>
      )}
    </main>
  );
}
