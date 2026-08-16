"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  movieArtworkObjectPosition,
  type PublicFilmSeries,
} from "@cinema/shared";
import { SeatPicker } from "../../components/seat-picker";
import { apiFetch, ApiRequestError } from "../../lib/api-client";

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

export default function FilmSeriesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [program, setProgram] = useState<FilmSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setError(null);

    apiFetch<FilmSeriesResponse>("/cinema/film-series")
      .then(setProgram)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError
            ? err.body.message
            : "Film series are unavailable.",
        ),
      );
  }, [loadAttempt]);

  useEffect(() => {
    setSelectedShowtimeId(null);
  }, [id]);

  const series = program?.series.find((entry) => entry.id === id);
  const formatShowtime = (startsAt: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: program?.location.timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(startsAt));

  if (selectedShowtimeId) {
    return (
      <main className="cinema-shell route-page">
        <SeatPicker
          showtimeId={selectedShowtimeId}
          onClose={() => setSelectedShowtimeId(null)}
        />
      </main>
    );
  }

  return (
    <main className="cinema-shell route-page">
      {error && (
        <>
          <div className="error-banner">{error}</div>
          <button
            className="primary"
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            Try again
          </button>
        </>
      )}
      {!program && !error && (
        <p className="loading-copy">Loading film series…</p>
      )}
      {program && !series && (
        <div className="error-banner">This film series is not available.</div>
      )}
      {series && (
        <article className="series-detail">
          <header className="series-hero">
            {series.artworkUrl && <img src={series.artworkUrl} alt="" />}
            <div>
              <span className="eyebrow">FILM SERIES</span>
              <h1>{series.name}</h1>
              {series.description && <p>{series.description}</p>}
            </div>
          </header>
          <div className="series-films">
            {series.movies.map((movie) => (
              <section className="series-film" key={movie.id}>
                <Link className="series-poster" href={`/movie/${movie.id}`}>
                  {movie.detailPosterUrl || movie.posterUrl ? (
                    <img
                      src={movie.detailPosterUrl ?? movie.posterUrl!}
                      alt={`${movie.title} poster`}
                      style={{
                        objectPosition: movieArtworkObjectPosition(
                          movie.detailPosterUrl
                            ? movie.detailPosterPosition
                            : movie.posterPosition,
                        ),
                      }}
                    />
                  ) : (
                    <span>{movie.title}</span>
                  )}
                </Link>
                <div>
                  <p className="movie-meta">
                    {movie.rating ?? "NR"} · {movie.runtimeMinutes} MIN
                  </p>
                  <h2>
                    <Link href={`/movie/${movie.id}`}>{movie.title}</Link>
                  </h2>
                  {movie.synopsis && <p>{movie.synopsis}</p>}
                  <div className="showtime-list">
                    {movie.showtimes.map((showtime) => {
                      const isPast =
                        new Date(showtime.startsAt).getTime() <= Date.now();
                      return (
                        <button
                          key={showtime.id}
                          className={isPast ? "past" : undefined}
                          disabled={isPast}
                          onClick={() => setSelectedShowtimeId(showtime.id)}
                        >
                          <strong>{formatShowtime(showtime.startsAt)}</strong>
                          <span>
                            {showtime.auditorium.name} ·{" "}
                            {presentationLabels[showtime.presentation] ??
                              showtime.presentation}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </article>
      )}
    </main>
  );
}
