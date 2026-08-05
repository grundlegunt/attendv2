"use client";

import Link from "next/link";
import type { NowPlayingMovie, PublicShowtime } from "@cinema/shared";

export function localDateKey(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function MovieTile({
  movie,
  showtimes,
  timeZone,
  onSelectShowtime,
  includeDate = false,
}: {
  movie: NowPlayingMovie;
  showtimes: PublicShowtime[];
  timeZone: string;
  onSelectShowtime: (id: string) => void;
  includeDate?: boolean;
}) {
  const series = Array.from(new Map(
    showtimes.flatMap((showtime) => showtime.filmSeries ? [[showtime.filmSeries.id, showtime.filmSeries] as const] : []),
  ).values());
  const formats = Array.from(new Set(showtimes.map((showtime) => showtime.format).filter(Boolean)));

  return (
    <article className="program-tile">
      <Link className="program-tile__image" href={`/movie/${movie.id}`}>
        {movie.posterUrl && <img src={movie.posterUrl} alt="" />}
      </Link>
      <div className="program-tile__info">
        <div className="program-tile__badges">
          {series.map((entry) => <span key={entry.id}>{entry.name}</span>)}
          {formats.map((format) => <span key={format}>{format}</span>)}
        </div>
        <div className="program-tile__title">
          <span>{movie.rating ?? "NR"} · {movie.runtimeMinutes} MIN</span>
          <h2><Link href={`/movie/${movie.id}`}>{movie.title}</Link></h2>
        </div>
      </div>
      <div className="program-tile__showtimes">
        {showtimes.map((showtime) => {
          const isPast = new Date(showtime.startsAt).getTime() <= Date.now();
          return (
            <button
              key={showtime.id}
              className={isPast ? "past" : undefined}
              disabled={isPast}
              aria-disabled={isPast}
              onClick={() => onSelectShowtime(showtime.id)}
            >
              {includeDate && <span>{new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(showtime.startsAt))}</span>}
              <strong>{new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(showtime.startsAt))}</strong>
              <small>{showtime.auditorium.name}{showtime.format ? ` · ${showtime.format}` : ""}</small>
            </button>
          );
        })}
      </div>
    </article>
  );
}
