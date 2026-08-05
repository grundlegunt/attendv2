"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SeatPicker } from "../components/seat-picker";
import { localDateKey, MovieTile } from "../components/movie-tile";

interface ProgramResponse {
  location: { id: string; name: string; timezone: string };
  movies: NowPlayingMovie[];
}

export default function ComingSoonPage() {
  const [program, setProgram] = useState<ProgramResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProgramResponse>("/cinema/now-playing")
      .then(setProgram)
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Coming soon is unavailable."));
  }, []);

  const movies = useMemo(() => {
    if (!program) return [];
    const today = localDateKey(new Date(), program.location.timezone);
    return program.movies.filter((movie) => {
      const first = movie.showtimes[0];
      return first && localDateKey(first.startsAt, program.location.timezone) > today;
    });
  }, [program]);

  return <main className="cinema-shell route-page">
    <section className="route-heading"><span className="eyebrow">UPCOMING ENGAGEMENTS</span><h1>Coming Soon</h1><p>Book ahead for films arriving after today.</p></section>
    {selectedShowtimeId ? <SeatPicker showtimeId={selectedShowtimeId} onClose={() => setSelectedShowtimeId(null)} /> : <>
      {error && <div className="error-banner">{error}</div>}
      {!program && !error && <p className="loading-copy">Loading upcoming films…</p>}
      {program && movies.length === 0 && <p className="loading-copy">No upcoming engagements are on sale yet.</p>}
      <section className="movie-grid">
        {program && movies.map((movie) => <MovieTile key={movie.id} movie={movie} showtimes={movie.showtimes} timeZone={program.location.timezone} onSelectShowtime={setSelectedShowtimeId} includeDate />)}
      </section>
    </>}
  </main>;
}
