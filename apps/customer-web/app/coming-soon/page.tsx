"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { localDateKey, MovieTile } from "../components/movie-tile";
import { useCinemaContent } from "../components/customer-branding";

interface ProgramResponse {
  location: { id: string; name: string; timezone: string };
  movies: NowPlayingMovie[];
}

export default function ComingSoonPage() {
  const { comingSoon: copy } = useCinemaContent();
  const [program, setProgram] = useState<ProgramResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setError(null);

    apiFetch<ProgramResponse>("/cinema/now-playing")
      .then(setProgram)
      .catch((reason) =>
        setError(
          reason instanceof ApiRequestError
            ? reason.body.message
            : "Coming soon is unavailable.",
        ),
      );
  }, [loadAttempt]);

  const movies = useMemo(() => {
    if (!program) return [];
    const today = localDateKey(new Date(), program.location.timezone);
    return program.movies
      .filter((movie) => {
        const first = movie.showtimes[0];
        return (
          first &&
          localDateKey(first.startsAt, program.location.timezone) > today
        );
      })
      .sort((left, right) => {
        const leftFirst = Math.min(
          ...left.showtimes.map((showtime) =>
            new Date(showtime.startsAt).getTime(),
          ),
        );
        const rightFirst = Math.min(
          ...right.showtimes.map((showtime) =>
            new Date(showtime.startsAt).getTime(),
          ),
        );
        return leftFirst - rightFirst || left.title.localeCompare(right.title);
      });
  }, [program]);

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>
      {error && <><div className="error-banner">{error}</div><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></>}
      {!program && !error && <p className="loading-copy">{copy.loading}</p>}
      {program && movies.length === 0 && (
        <p className="loading-copy">{copy.empty}</p>
      )}
      <section className="movie-grid">
        {program &&
          movies.map((movie) => (
            <MovieTile
              key={movie.id}
              movie={movie}
              showtimes={movie.showtimes}
              timeZone={program.location.timezone}
              firstDateOnly
            />
          ))}
      </section>
    </main>
  );
}
