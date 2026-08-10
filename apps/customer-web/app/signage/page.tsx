"use client";

import { useEffect, useMemo, useState } from "react";
import type { NowPlayingMovie, PublicShowtime } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface Program { location: { name: string; timezone: string }; movies: NowPlayingMovie[] }
type Listing = { movie: NowPlayingMovie; showtime: PublicShowtime };

export default function SignagePage() {
  const [program, setProgram] = useState<Program | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = () => void apiFetch<Program>("/cinema/now-playing").then((next) => { setProgram(next); setError(null); }).catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Showtimes are unavailable."));
    load();
    const dataTimer = window.setInterval(load, 60_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearInterval(dataTimer); window.clearInterval(clockTimer); };
  }, []);

  const listings = useMemo(() => (program?.movies.flatMap((movie) => movie.showtimes.map((showtime) => ({ movie, showtime }))) ?? []).filter(({ showtime }) => new Date(showtime.startsAt).getTime() >= now - 20 * 60_000).sort((a, b) => new Date(a.showtime.startsAt).getTime() - new Date(b.showtime.startsAt).getTime()).slice(0, 12), [now, program]);
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: program?.location.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));

  return <main className="signage-shell">
    <header><div><span>NOW SHOWING</span><h1>{program?.location.name ?? "Attend Cinema"}</h1></div><time>{new Intl.DateTimeFormat("en-US", { timeZone: program?.location.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(now))}</time></header>
    {error && <div className="signage-message">{error}</div>}
    {!error && program && listings.length === 0 && <div className="signage-message">No more showtimes today.</div>}
    <section className="signage-grid">{listings.map(({ movie, showtime }: Listing) => <article key={showtime.id}>{movie.posterUrl ? <img src={movie.posterUrl} alt="" /> : <div className="signage-poster">ATTEND</div>}<div><time>{time(showtime.startsAt)}</time><h2>{movie.title}</h2><p>{showtime.auditorium.name}{showtime.format ? ` · ${showtime.format}` : ""}</p><small>{movie.rating ?? "NR"} · {movie.runtimeMinutes} min</small></div></article>)}</section>
    <footer>Showtimes update automatically</footer>
  </main>;
}
