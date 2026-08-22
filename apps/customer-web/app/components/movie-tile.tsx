"use client";

import Link from "next/link";
import {
  movieArtworkObjectPosition,
  type NowPlayingMovie,
  type PublicShowtime,
} from "@cinema/shared";
import { TrailerTrigger } from "./trailer-modal";

export function localDateKey(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function presentationBadge(presentation: PublicShowtime["presentation"]) {
  switch (presentation) {
    case "OPEN_CAPTIONS":
      return { shortLabel: "OC", label: "Open captions" };
    case "Q_AND_A":
      return { shortLabel: "Q&A", label: "Q and A" };
    case "SPECIAL_GUEST":
      return { shortLabel: "Guest", label: "Special guest" };
    default:
      return null;
  }
}

export function MovieTile({
  movie,
  showtimes,
  timeZone,
  onSelectShowtime,
  includeDate = false,
  firstDateOnly = false,
}: {
  movie: NowPlayingMovie;
  showtimes: PublicShowtime[];
  timeZone: string;
  onSelectShowtime?: (id: string) => void;
  includeDate?: boolean;
  firstDateOnly?: boolean;
}) {
  const series = Array.from(
    new Map(
      showtimes.flatMap((showtime) =>
        showtime.filmSeries
          ? [[showtime.filmSeries.id, showtime.filmSeries] as const]
          : [],
      ),
    ).values(),
  );
  const formats = Array.from(
    new Set(showtimes.map((showtime) => showtime.format).filter(Boolean)),
  );
  const firstShowtime = showtimes.reduce<PublicShowtime | undefined>(
    (earliest, showtime) =>
      !earliest || new Date(showtime.startsAt) < new Date(earliest.startsAt)
        ? showtime
        : earliest,
    undefined,
  );

  return (
    <article className="program-tile">
      <div className="program-tile__image">
        <Link
          className="program-tile__artwork"
          href={`/movie/${movie.id}`}
          aria-label={`View ${movie.title}`}
        >
          {movie.posterUrl && (
            <img
              src={movie.posterUrl}
              alt=""
              style={{
                objectPosition: movieArtworkObjectPosition(
                  movie.posterPosition,
                ),
              }}
            />
          )}
        </Link>
        <div className="program-tile__hover">
          {movie.synopsis && <p>{movie.synopsis}</p>}
          <div>
            {movie.trailerUrl && <TrailerTrigger className="program-tile__hover-action" url={movie.trailerUrl} title={movie.title}>Trailer</TrailerTrigger>}
            <Link className="program-tile__hover-action" href={`/movie/${movie.id}`}>Details</Link>
          </div>
        </div>
        <div className="program-tile__badges">
          {series.map((entry) => (
            <Link key={entry.id} href={`/film-series/${entry.id}`}>
              {entry.name}
            </Link>
          ))}
          {formats.map((format) => (
            <span key={format}>{format}</span>
          ))}
        </div>
        <h2 className="program-tile__title">
          <Link href={`/movie/${movie.id}`}>{movie.title}</Link>
        </h2>
      </div>
      {firstDateOnly && firstShowtime ? (
        <Link className="program-tile__first-date" href={`/movie/${movie.id}`}>
          <span>First showing</span>
          <strong>
            {new Intl.DateTimeFormat("en-US", {
              timeZone,
              month: "long",
              day: "numeric",
            }).format(new Date(firstShowtime.startsAt))}
          </strong>
        </Link>
      ) : (
        <div className="program-tile__showtimes">
          {showtimes.map((showtime) => {
            const isPast = new Date(showtime.startsAt).getTime() <= Date.now();
            const presentation = presentationBadge(showtime.presentation);
            return (
              <button
                key={showtime.id}
                className={isPast ? "past" : undefined}
                disabled={isPast}
                aria-disabled={isPast}
                onClick={() => onSelectShowtime?.(showtime.id)}
              >
                {includeDate && (
                  <span>
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone,
                      month: "short",
                      day: "numeric",
                    }).format(new Date(showtime.startsAt))}
                  </span>
                )}
                <span className="program-tile__showtime-time">
                  <strong>
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone,
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(showtime.startsAt))}
                  </strong>
                  {presentation && (
                    <abbr
                      className="program-tile__presentation"
                      title={presentation.label}
                      aria-label={presentation.label}
                    >
                      {presentation.shortLabel}
                    </abbr>
                  )}
                </span>
                <small>
                  {showtime.auditorium.name}
                  {showtime.format ? ` · ${showtime.format}` : ""}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
