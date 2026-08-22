"use client";

import { use, useEffect, useMemo, useState } from "react";
import {
  movieArtworkObjectPosition,
  type PublicMovieDetail,
} from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../../lib/api-client";
import { SeatPicker } from "../../components/seat-picker";
import { localDateKey } from "../../components/movie-tile";
import { TrailerTrigger } from "../../components/trailer-modal";

interface DetailResponse {
  location: { id: string; name: string; timezone: string };
  movie: PublicMovieDetail;
}

export default function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    setData(null);
    setError(null);
    setSelectedShowtimeId(null);
    setSelectedDate(null);

    apiFetch<DetailResponse>(`/cinema/movies/${id}`)
      .then((response) => {
        if (isCurrent) setData(response);
      })
      .catch((reason) => {
        if (isCurrent)
          setError(
            reason instanceof ApiRequestError
              ? reason.body.message
              : "Movie details are unavailable.",
          );
      });

    return () => {
      isCurrent = false;
    };
  }, [id, loadAttempt]);

  const dates = useMemo(
    () =>
      data
        ? Array.from(
            new Set(
              data.movie.showtimes.map((showtime) =>
                localDateKey(showtime.startsAt, data.location.timezone),
              ),
            ),
          )
        : [],
    [data],
  );
  const activeDate = selectedDate ?? dates[0] ?? null;
  const showtimes =
    data?.movie.showtimes.filter(
      (showtime) =>
        localDateKey(showtime.startsAt, data.location.timezone) === activeDate,
    ) ?? [];
  const formats = Array.from(
    new Set(
      data?.movie.showtimes
        .map((showtime) => showtime.format)
        .filter(Boolean) ?? [],
    ),
  );

  if (selectedShowtimeId)
    return (
      <main className="cinema-shell route-page">
        <SeatPicker
          showtimeId={selectedShowtimeId}
          onClose={() => setSelectedShowtimeId(null)}
        />
      </main>
    );
  if (error)
    return (
      <main className="cinema-shell route-page">
        <div className="error-banner">{error}</div>
        <button
          className="primary"
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Try again
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="cinema-shell route-page">
        <p className="loading-copy">Loading movie…</p>
      </main>
    );

  const { movie } = data;
  return (
    <main className="cinema-shell route-page movie-detail">
      <section className="movie-detail__hero">
        <aside>
          <div className="movie-detail__poster">
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
          </div>
          {movie.trailerUrl && (
            <TrailerTrigger
              className="primary-link movie-detail__trailer"
              url={movie.trailerUrl}
              title={movie.title}
            >
              Watch Trailer
            </TrailerTrigger>
          )}
        </aside>
        <div className="movie-detail__copy">
          <span className="eyebrow">NOW BOOKING</span>
          <h1>{movie.title}</h1>
          {dates.length > 0 && (
            <nav className="detail-date-bar" aria-label="Showtime dates">
              {dates.map((date) => (
                <button
                  key={date}
                  className={date === activeDate ? "active" : ""}
                  onClick={() => setSelectedDate(date)}
                >
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: data.location.timezone,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  }).format(new Date(`${date}T12:00:00`))}
                </button>
              ))}
            </nav>
          )}
          <div className="showtime-list">
            {showtimes.map((showtime) => (
              <button
                key={showtime.id}
                onClick={() => setSelectedShowtimeId(showtime.id)}
              >
                <strong>
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: data.location.timezone,
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(showtime.startsAt))}
                </strong>
                <span>
                  {showtime.auditorium.name}
                  {showtime.format ? ` · ${showtime.format}` : ""}
                </span>
              </button>
            ))}
          </div>
          <dl className="movie-facts">
            {movie.director && (
              <>
                <dt>Director</dt>
                <dd>{movie.director}</dd>
              </>
            )}
            <dt>Run Time</dt>
            <dd>{movie.runtimeMinutes} minutes</dd>
            {formats.length > 0 && (
              <>
                <dt>Format</dt>
                <dd>{formats.join(", ")}</dd>
              </>
            )}
            <dt>Rating</dt>
            <dd>{movie.rating ?? "NR"}</dd>
            {movie.releaseYear && (
              <>
                <dt>Release Year</dt>
                <dd>{movie.releaseYear}</dd>
              </>
            )}
            {movie.starring && (
              <>
                <dt>Starring</dt>
                <dd>{movie.starring}</dd>
              </>
            )}
          </dl>
          {movie.synopsis && (
            <p className="movie-detail__synopsis">{movie.synopsis}</p>
          )}
        </div>
      </section>
      {movie.pairings.length > 0 && (
        <section className="pairings">
          <span className="eyebrow">FEATURED WITH THIS FILM</span>
          <h2>Paired Food &amp; Drink Special</h2>
          <div className="pairing-grid">
            {movie.pairings.map((item) => (
              <article key={item.id}>
                {item.imageUrl && <img src={item.imageUrl} alt="" />}
                <div>
                  <h3>{item.name}</h3>
                  {item.description && <p>{item.description}</p>}
                  <strong>${(item.priceCents / 100).toFixed(2)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
