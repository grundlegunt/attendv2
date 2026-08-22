import Link from "next/link";
import {
  movieArtworkObjectPosition,
  type NowPlayingMovie,
  type PublicShowtime,
} from "@cinema/shared";
import { localDateKey } from "./movie-tile";
import { TrailerTrigger } from "./trailer-modal";

type EditorialMovieListProps = {
  movies: NowPlayingMovie[];
  timeZone: string;
  variant: "open-captions" | "just-announced";
  onSelectShowtime?: (showtimeId: string) => void;
};

function formatDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatTime(startsAt: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(startsAt));
}

function groupByDate(showtimes: PublicShowtime[], timeZone: string) {
  return showtimes.reduce<Record<string, PublicShowtime[]>>((groups, showtime) => {
    const date = localDateKey(showtime.startsAt, timeZone);
    groups[date] = [...(groups[date] ?? []), showtime];
    return groups;
  }, {});
}

function announcedDate(movie: NowPlayingMovie, timeZone: string) {
  const dates = movie.showtimes
    .map((showtime) => localDateKey(showtime.startsAt, timeZone))
    .sort();
  if (!dates.length) return null;
  const firstDate = dates[0]!;
  const lastDate = dates[dates.length - 1]!;
  if (dates.length === 1 || firstDate === lastDate) {
    return `Starts: ${formatDate(firstDate)}`;
  }
  return `Screens: ${formatDate(firstDate)}–${formatDate(lastDate)}`;
}

export function EditorialMovieList({
  movies,
  timeZone,
  variant,
  onSelectShowtime,
}: EditorialMovieListProps) {
  const openCaptions = variant === "open-captions";

  return (
    <section className="editorial-program">
      <header className="editorial-program__header">
        <h1>{openCaptions ? "Open Captions" : "Just Announced"}</h1>
      </header>
      {!openCaptions ? (
        <p className="editorial-program__intro">
          Be the first to know when newly announced tickets become available.
        </p>
      ) : null}

      <div className="editorial-program__list">
        {movies.map((movie) => {
          const image = movie.detailPosterUrl ?? movie.posterUrl;
          const dates = groupByDate(movie.showtimes, timeZone);
          const formats = Array.from(
            new Set(movie.showtimes.map((showtime) => showtime.format).filter(Boolean)),
          ).join(", ");

          return (
            <article className="editorial-movie" key={movie.id}>
              <div className="editorial-movie__art">
                {image ? (
                  <img
                    alt={`${movie.title} poster`}
                    src={image}
                    style={{
                      objectPosition: movieArtworkObjectPosition(
                        movie.detailPosterPosition ?? movie.posterPosition,
                      ),
                    }}
                  />
                ) : (
                  <div className="editorial-movie__placeholder">{movie.title}</div>
                )}
                {openCaptions && movie.trailerUrl ? (
                  <TrailerTrigger className="editorial-movie__trailer" url={movie.trailerUrl} title={movie.title}>
                    Watch trailer
                  </TrailerTrigger>
                ) : null}
              </div>

              <div className="editorial-movie__content">
                <h2>{movie.title}</h2>

                {openCaptions ? (
                  <>
                    <div className="editorial-movie__showtimes">
                      {Object.entries(dates).map(([date, showtimes]) => (
                        <div className="editorial-movie__date" key={date}>
                          <strong>{formatDate(date)}</strong>
                          <div>
                            {showtimes.map((showtime) => (
                              <button
                                key={showtime.id}
                                onClick={() => onSelectShowtime?.(showtime.id)}
                                type="button"
                              >
                                {formatTime(showtime.startsAt, timeZone)} <span>OC</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <dl className="editorial-movie__facts">
                      {movie.director ? <><dt>Director</dt><dd>{movie.director}</dd></> : null}
                      {movie.runtimeMinutes ? <><dt>Run time</dt><dd>{movie.runtimeMinutes} min.</dd></> : null}
                      {formats ? <><dt>Format</dt><dd>{formats}</dd></> : null}
                      {movie.rating ? <><dt>Rating</dt><dd>{movie.rating}</dd></> : null}
                      {movie.releaseYear ? <><dt>Release year</dt><dd>{movie.releaseYear}</dd></> : null}
                    </dl>
                  </>
                ) : (
                  <p className="editorial-movie__announcement">
                    {announcedDate(movie, timeZone)}
                  </p>
                )}

                {movie.synopsis ? <p className="editorial-movie__synopsis">{movie.synopsis}</p> : null}
                <Link className="editorial-movie__more" href={`/movie/${movie.id}`}>
                  See more
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
