"use client";

import { useEffect, useState } from "react";
import type { PublicFilmSeries } from "@cinema/shared";
import { SeatPicker } from "../components/seat-picker";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface FilmSeriesResponse {
  location: { id: string; name: string; timezone: string };
  series: PublicFilmSeries[];
}

const presentationLabels: Record<string, string> = {
  STANDARD: "Standard",
  OPEN_CAPTIONS: "Open captions",
  Q_AND_A: "Q&A",
  SPECIAL_GUEST: "Special guest",
};

export default function FilmSeriesPage() {
  const [program, setProgram] = useState<FilmSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<FilmSeriesResponse>("/cinema/film-series")
      .then(setProgram)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Film series are unavailable."));
  }, []);

  const formatShowtime = (startsAt: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: program?.location.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">CURATED PROGRAMS</span>
        <h1>Film Series</h1>
        <p>Special programs, repertory runs, and recurring cinema events at {program?.location.name ?? "the cinema"}.</p>
      </section>

      {selectedShowtimeId ? (
        <SeatPicker showtimeId={selectedShowtimeId} onClose={() => setSelectedShowtimeId(null)} />
      ) : (
        <>
          {error && <div className="error-banner">{error}</div>}
          {!program && !error && <p className="loading-copy">Loading film series…</p>}
          {program && program.series.length === 0 && <p className="loading-copy">No film series are on sale yet.</p>}
          <section className="series-grid">
            {program?.series.map((series) => (
              <article className="series-card" key={series.id}>
                <header className="series-hero">
                  {series.artworkUrl && <img src={series.artworkUrl} alt="" />}
                  <div>
                    <span className="eyebrow">FILM SERIES</span>
                    <h2>{series.name}</h2>
                    {series.description && <p>{series.description}</p>}
                  </div>
                </header>
                <div className="series-films">
                  {series.movies.map((movie) => (
                    <section className="series-film" key={movie.id}>
                      <div className="series-poster">
                        {movie.posterUrl ? <img src={movie.posterUrl} alt={`${movie.title} poster`} /> : <span>{movie.title}</span>}
                      </div>
                      <div>
                        <p className="movie-meta">{movie.rating ?? "NR"} · {movie.runtimeMinutes} MIN</p>
                        <h3>{movie.title}</h3>
                        {movie.synopsis && <p>{movie.synopsis}</p>}
                        <div className="showtime-list">
                          {movie.showtimes.map((showtime) => (
                            <button key={showtime.id} onClick={() => setSelectedShowtimeId(showtime.id)}>
                              <strong>{formatShowtime(showtime.startsAt)}</strong>
                              <span>{showtime.auditorium.name} · {presentationLabels[showtime.presentation] ?? showtime.presentation}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
