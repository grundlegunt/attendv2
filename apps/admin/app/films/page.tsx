"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Movie = {
  id: string;
  title: string;
  runtimeMinutes: number;
  synopsis?: string | null;
  rating?: string | null;
  posterUrl?: string | null;
  director?: string | null;
  releaseYear?: number | null;
  distributorName?: string | null;
};

type Bootstrap = {
  location: { organization: { movies: Movie[] } };
  archivedMovies: Movie[];
  showtimes: Array<{ startsAt: string; movie: { id: string } }>;
};

export default function FilmLibraryPage() {
  const { accessToken } = useAdminSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken, signal: controller.signal })
      .then(setData)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "The film library could not be loaded.");
      });
    return () => controller.abort();
  }, [accessToken]);

  const counts = useMemo(() => {
    const now = Date.now();
    const result = new Map<string, { total: number; upcoming: number }>();
    for (const showtime of data?.showtimes ?? []) {
      const current = result.get(showtime.movie.id) ?? { total: 0, upcoming: 0 };
      current.total += 1;
      if (new Date(showtime.startsAt).getTime() >= now) current.upcoming += 1;
      result.set(showtime.movie.id, current);
    }
    return result;
  }, [data]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (movie: Movie) => !normalizedQuery || [movie.title, movie.director, movie.distributorName]
    .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  const active = (data?.location.organization.movies ?? []).filter(matches);
  const archived = (data?.archivedMovies ?? []).filter(matches);

  return <main className="admin-route-page standalone-film-library">
    <header className="admin-page-heading"><div><p className="kicker">PROGRAMMING</p><h1>Film Library</h1><p>Browse every film, open its complete performance record, or manage its programming details.</p></div><Link href="/scheduling" className="primary">Add or edit films</Link></header>
    <label className="film-library-index-search"><span>Search films</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, director, or distributor" /></label>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!data && !error && <p className="dashboard-empty">Loading film library…</p>}
    {data && <>
      <section aria-labelledby="active-films-heading"><div className="dashboard-section-heading"><div><p className="kicker">ACTIVE INVENTORY</p><h2 id="active-films-heading">Current films</h2></div><span>{active.length} films</span></div>
        <div className="film-library-index-grid">{active.map((movie) => <FilmCard key={movie.id} movie={movie} counts={counts.get(movie.id)} />)}</div>
        {!active.length && <p className="dashboard-empty">No active films match this search.</p>}
      </section>
      <section aria-labelledby="archived-films-heading"><div className="dashboard-section-heading"><div><p className="kicker">ARCHIVE</p><h2 id="archived-films-heading">Archived films</h2></div><span>{archived.length} films</span></div>
        <div className="film-library-index-grid">{archived.map((movie) => <FilmCard key={movie.id} movie={movie} archived />)}</div>
        {!archived.length && <p className="dashboard-empty">No archived films match this search.</p>}
      </section>
    </>}
  </main>;
}

function FilmCard({ movie, counts, archived = false }: { movie: Movie; counts?: { total: number; upcoming: number }; archived?: boolean }) {
  return <article className="panel film-library-index-card">
    {movie.posterUrl ? <img src={movie.posterUrl} alt="" /> : <div className="film-library-index-placeholder" aria-hidden="true">{movie.title.slice(0, 1)}</div>}
    <div><span className={`status-chip ${archived ? "" : "status-success"}`}>{archived ? "Archived" : "Active"}</span><h3>{movie.title}</h3><p>{movie.releaseYear ?? "Year unknown"} · {movie.rating || "Not rated"} · {movie.runtimeMinutes} min</p><p>{movie.distributorName || "Distributor not set"}</p>{!archived && <small>{counts?.upcoming ?? 0} upcoming · {counts?.total ?? 0} total performances</small>}<div className="film-library-index-actions"><Link href={`/films/${encodeURIComponent(movie.id)}`}>View performance</Link><Link href="/scheduling" className="secondary">Manage film</Link></div></div>
  </article>;
}
