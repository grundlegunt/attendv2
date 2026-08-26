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

type CatalogFilm = Movie & {
  synopsis: string | null;
  starring: string | null;
  primaryDistributorName: string | null;
  imdbId: string | null;
  verified: boolean;
  importedMovieId: string | null;
};

export default function FilmLibraryPage() {
  const { accessToken } = useAdminSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogFilm[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken, signal: controller.signal })
      .then(setData)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "The film library could not be loaded.");
      });
    return () => controller.abort();
  }, [accessToken, refreshKey]);

  useEffect(() => {
    if (!catalogOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      const params = new URLSearchParams();
      if (catalogQuery.trim()) params.set("q", catalogQuery.trim());
      apiFetch<{ entries: CatalogFilm[] }>(`/cinema/film-catalog?${params}`, { accessToken, signal: controller.signal })
        .then((result) => setCatalog(result.entries))
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "The shared film catalog could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [accessToken, catalogOpen, catalogQuery, refreshKey]);

  async function importFilm(film: CatalogFilm) {
    if (importingId) return;
    setImportingId(film.id); setError(null);
    try {
      await apiFetch(`/cinema/film-catalog/${encodeURIComponent(film.id)}/import`, { accessToken, method: "POST" });
      setRefreshKey((current) => current + 1);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "The film could not be added to this cinema.");
    } finally { setImportingId(null); }
  }

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
    <header className="admin-page-heading"><div><p className="kicker">PROGRAMMING</p><h1>Film Library</h1><p>Browse every film, open its complete performance record, or manage its programming details.</p></div><div className="film-library-heading-actions"><button className="secondary" onClick={() => setCatalogOpen((current) => !current)}>{catalogOpen ? "Close shared catalog" : "Add from Ringo catalog"}</button><Link href="/scheduling" className="primary">Add manually</Link></div></header>
    {catalogOpen && <section className="panel shared-film-catalog" aria-labelledby="shared-catalog-heading"><div className="dashboard-section-heading"><div><p className="kicker">RINGO FILM DATABASE</p><h2 id="shared-catalog-heading">Add a shared film</h2><p>Reuse verified film facts. Your cinema’s bookings, deal terms, pricing, and performance remain private.</p></div><span>{catalog.length} results</span></div><label><span>Search title, filmmaker, cast, distributor, IMDb, or EIDR</span><input autoFocus type="search" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search shared films" /></label>{catalogLoading && <p className="dashboard-empty">Searching Ringo’s catalog…</p>}<div className="shared-film-catalog-grid">{!catalogLoading && catalog.map((film) => <article key={film.id}><div>{film.posterUrl ? <img src={film.posterUrl} alt="" /> : <span aria-hidden="true">{film.title.slice(0, 1)}</span>}</div><div><span className={`status-chip ${film.verified ? "status-success" : ""}`}>{film.verified ? "Ringo verified" : "Community record"}</span><h3>{film.title}</h3><p>{[film.releaseYear, `${film.runtimeMinutes} min`, film.rating].filter(Boolean).join(" · ")}</p><small>{film.primaryDistributorName || "Distributor not set"}{film.imdbId ? ` · ${film.imdbId}` : ""}</small></div>{film.importedMovieId ? <Link href={`/films/${encodeURIComponent(film.importedMovieId)}`}>Already in library</Link> : <button disabled={Boolean(importingId)} onClick={() => void importFilm(film)}>{importingId === film.id ? "Adding…" : "Add to library"}</button>}</article>)}</div>{!catalogLoading && !catalog.length && <p className="dashboard-empty">No shared films match this search. You can still add the film manually.</p>}</section>}
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
