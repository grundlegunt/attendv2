"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { showtimeDateStrip, type NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SeatPicker } from "../components/seat-picker";
import { localDateKey, MovieTile } from "../components/movie-tile";
import { ShowtimeCalendar } from "../components/showtime-calendar";
import { useCinemaContent } from "../components/customer-branding";
import { MovieSpecials } from "../components/movie-specials";
import { usePublicDiningMenu } from "../components/public-dining-menu";
import { EditorialMovieList } from "../components/editorial-movie-list";

interface NowPlayingResponse {
  location: {
    id: string;
    name: string;
    address: string | null;
    timezone: string;
  };
  movies: NowPlayingMovie[];
}

function ShowtimesContent() {
  const { showtimes: copy } = useCinemaContent();
  const { menu } = usePublicDiningMenu();
  const searchParams = useSearchParams();
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const openCaptionsOnly =
    searchParams.get("presentation") === "OPEN_CAPTIONS";

  const programMovies = useMemo(() => (program?.movies ?? [])
    .map((movie) => ({
      ...movie,
      showtimes: openCaptionsOnly
        ? movie.showtimes.filter((showtime) => showtime.presentation === "OPEN_CAPTIONS")
        : movie.showtimes,
    }))
    .filter((movie) => movie.showtimes.length > 0), [openCaptionsOnly, program]);

  const availableDates = useMemo(
    () =>
      Array.from(
        new Set(
          programMovies.flatMap((movie) =>
            movie.showtimes.map((showtime) =>
              localDateKey(showtime.startsAt, program!.location.timezone),
            ),
          ),
        ),
      ).sort(),
    [program, programMovies],
  );
  const activeDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    if (!program) return availableDates[0] ?? null;
    const today = localDateKey(new Date(), program.location.timezone);
    return availableDates.includes(today)
      ? today
      : (availableDates.find((date) => date > today) ??
          availableDates[0] ??
          null);
  }, [availableDates, program, selectedDate]);
  const todayKey = useMemo(
    () => program ? localDateKey(new Date(), program.location.timezone) : null,
    [program],
  );
  const visibleDates = useMemo(
    () => todayKey ? showtimeDateStrip(todayKey, activeDate) : [],
    [activeDate, todayKey],
  );

  const moviesForActiveDate = useMemo(() => {
    if (!program || !activeDate) return [];
    return programMovies
      .map((movie) => ({
        movie,
        showtimes: movie.showtimes
          .filter(
            (showtime) =>
              localDateKey(showtime.startsAt, program.location.timezone) ===
              activeDate,
          )
          .sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
          ),
      }))
      .filter((entry) => entry.showtimes.length > 0)
      .sort(
        (a, b) =>
          new Date(a.showtimes[0]!.startsAt).getTime() -
          new Date(b.showtimes[0]!.startsAt).getTime(),
      );
  }, [program, activeDate, programMovies]);
  const specialsForActiveDate = useMemo(() => {
    if (!menu) return [];
    const specialsByMovie = new Map(menu.movieSpecials.map((special) => [special.movieId, special]));
    return moviesForActiveDate.flatMap(({ movie }) => {
      const special = specialsByMovie.get(movie.id);
      return special ? [special] : [];
    });
  }, [menu, moviesForActiveDate]);

  useEffect(() => {
    const controller = new AbortController();
    setProgramError(null);

    apiFetch<NowPlayingResponse>("/cinema/now-playing", { signal: controller.signal })
      .then(setProgram)
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setProgramError(
          err instanceof ApiRequestError
            ? err.body.message
            : "Showtimes are unavailable.",
        );
      });

    return () => controller.abort();
  }, [loadAttempt]);

  return (
    <main className="cinema-shell route-page">
      {!openCaptionsOnly && !selectedShowtimeId && <section className="route-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        {program && <p>{copy.intro}</p>}
      </section>}

      {!openCaptionsOnly && !selectedShowtimeId && visibleDates.length > 0 && (
        <nav className="date-bar" aria-label="Showtime dates">
          {visibleDates.map((dateKey) => {
            const date = new Date(`${dateKey}T00:00:00Z`);
            return (
              <button
                key={dateKey}
                className={dateKey === activeDate ? "active" : ""}
                onClick={() => setSelectedDate(dateKey)}
              >
                <span>
                  {dateKey === todayKey
                    ? "Today"
                    : date.toLocaleDateString([], { weekday: "long", timeZone: "UTC" })}
                </span>
                <strong>
                  {date.toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </strong>
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
        <SeatPicker
          showtimeId={selectedShowtimeId}
          onClose={() => setSelectedShowtimeId(null)}
        />
      ) : (
        <>
          {programError && <><div className="error-banner">{programError}</div><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></>}
          {!program && !programError && (
            <p className="loading-copy">{copy.loading}</p>
          )}
          {program && programMovies.length === 0 && (
            <p className="loading-copy">{copy.empty}</p>
          )}
          {program &&
            programMovies.length > 0 &&
            !openCaptionsOnly &&
            moviesForActiveDate.length === 0 && (
              <p className="loading-copy">{copy.emptyDate}</p>
            )}

          {program && openCaptionsOnly && programMovies.length > 0 ? (
            <EditorialMovieList
              movies={programMovies}
              timeZone={program.location.timezone}
              variant="open-captions"
              onSelectShowtime={setSelectedShowtimeId}
            />
          ) : (
            <>
              <section className="movie-grid showtimes-movie-grid">
                {moviesForActiveDate.map(({ movie, showtimes }) => <MovieTile
                  key={movie.id}
                  movie={movie}
                  showtimes={showtimes}
                  timeZone={program!.location.timezone}
                  onSelectShowtime={setSelectedShowtimeId}
                />)}
              </section>
              <MovieSpecials specials={specialsForActiveDate} showtimes />
            </>
          )}
        </>
      )}
    </main>
  );
}

export default function ShowtimesPage() {
  return (
    <Suspense fallback={<main className="cinema-shell route-page" />}>
      <ShowtimesContent />
    </Suspense>
  );
}
