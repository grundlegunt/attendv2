"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { localDateKey, MovieTile } from "../components/movie-tile";
import { useCinemaContent } from "../components/customer-branding";
import { EditorialMovieList } from "../components/editorial-movie-list";

interface ProgramResponse {
  location: { id: string; name: string; timezone: string };
  movies: NowPlayingMovie[];
}

function ComingSoonContent() {
  const { comingSoon: copy } = useCinemaContent();
  const searchParams = useSearchParams();
  const [program, setProgram] = useState<ProgramResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const justAnnounced = searchParams.get("view") === "JUST_ANNOUNCED";

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
    const upcoming = program.movies
      .filter((movie) => {
        const first = movie.showtimes[0];
        return (
          first &&
          localDateKey(first.startsAt, program.location.timezone) > today
        );
      })
      .sort((left, right) => {
        if (justAnnounced) {
          const announcementOrder =
            new Date(right.createdAt ?? 0).getTime() -
            new Date(left.createdAt ?? 0).getTime();
          if (announcementOrder !== 0) return announcementOrder;
        }
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

    return justAnnounced ? upcoming.slice(0, 6) : upcoming;
  }, [justAnnounced, program]);

  return (
    <main className="cinema-shell route-page">
      {!justAnnounced && <section className="route-heading">
        <span className="eyebrow">
          {copy.eyebrow}
        </span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>}
      {error && <><div className="error-banner">{error}</div><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></>}
      {!program && !error && <p className="loading-copy">{copy.loading}</p>}
      {program && movies.length === 0 && (
        <p className="loading-copy">
          {justAnnounced ? "No newly announced films yet." : copy.empty}
        </p>
      )}
      {program && justAnnounced && movies.length > 0 ? (
        <EditorialMovieList
          movies={movies}
          timeZone={program.location.timezone}
          variant="just-announced"
        />
      ) : (
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
      )}
    </main>
  );
}

export default function ComingSoonPage() {
  return (
    <Suspense fallback={<main className="cinema-shell route-page" />}>
      <ComingSoonContent />
    </Suspense>
  );
}
