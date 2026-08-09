"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SeatPicker } from "../components/seat-picker";
import { localDateKey, MovieTile } from "../components/movie-tile";
import { ShowtimeCalendar } from "../components/showtime-calendar";

interface NowPlayingResponse {
  location: { id: string; name: string; address: string | null; timezone: string };
  movies: NowPlayingMovie[];
}

export default function ShowtimesPage() {
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const programMovies = useMemo(() => program?.movies ?? [], [program]);

  const availableDates = useMemo(
    () => Array.from(new Set(
      programMovies.flatMap((movie) => movie.showtimes.map((showtime) => localDateKey(showtime.startsAt, program!.location.timezone))),
    )).sort(),
    [program, programMovies],
  );
  const visibleDates = useMemo(() => {
    if (!program) return [];
    const todayKey = localDateKey(new Date(), program.location.timezone);
    const today = new Date(`${todayKey}T12:00:00`);

    return Array.from({ length: 3 }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return localDateKey(date, program.location.timezone);
    });
  }, [program]);
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
    return programMovies
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
  }, [program, activeDate, programMovies]);

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

      {!selectedShowtimeId && visibleDates.length > 0 && (
        <nav className="date-bar" aria-label="Showtime dates">
          {visibleDates.map((dateKey, index) => {
            const date = new Date(`${dateKey}T12:00:00`);
            return (
              <button
                key={dateKey}
                className={dateKey === activeDate ? "active" : ""}
                onClick={() => setSelectedDate(dateKey)}
              >
                <span>{index === 0 ? "Today" : date.toLocaleDateString([], { weekday: "long" })}</span>
                <strong>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
              </button>
            );
          })}
          <button
            type="button"
            className="date-bar__calendar"
            aria-label="Choose a date from the calendar"
            aria-expanded={calendarOpen}
            onClick={() => setCalendarOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 32 32">
              <path d="M6 4v4M12 4v4M20 4v4M26 4v4M4 9h24v19H4zM4 14h24M10 14v14M18 14v14M10 21h18" />
            </svg>
          </button>
        </nav>
      )}

      {calendarOpen && program && (
        <ShowtimeCalendar
          availableDates={availableDates}
          selectedDate={activeDate}
          today={localDateKey(new Date(), program.location.timezone)}
          onSelect={setSelectedDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {selectedShowtimeId ? (
        <SeatPicker showtimeId={selectedShowtimeId} onClose={() => setSelectedShowtimeId(null)} />
      ) : (
        <>
          {programError && <div className="error-banner">{programError}</div>}
          {!program && !programError && <p className="loading-copy">Loading the program…</p>}
          {program && programMovies.length === 0 && <p className="loading-copy">No showtimes are currently on sale.</p>}
          {program && programMovies.length > 0 && moviesForActiveDate.length === 0 && (
            <p className="loading-copy">No showtimes are scheduled for this date.</p>
          )}

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
