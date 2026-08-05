"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicFilmSeries } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface FilmSeriesResponse {
  location: { id: string; name: string; timezone: string };
  series: PublicFilmSeries[];
}

export default function FilmSeriesPage() {
  const [program, setProgram] = useState<FilmSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<FilmSeriesResponse>("/cinema/film-series")
      .then(setProgram)
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Film series are unavailable."));
  }, []);

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">CURATED PROGRAMS</span>
        <h1>Film Series</h1>
        <p>Special programs, repertory runs, and recurring cinema events at {program?.location.name ?? "the cinema"}.</p>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {!program && !error && <p className="loading-copy">Loading film series…</p>}
      {program && program.series.length === 0 && <p className="loading-copy">No film series are on sale yet.</p>}
      <section className="series-grid">
        {program?.series.map((series) => (
          <article className="series-card" key={series.id}>
            <Link className="series-tile" href={`/film-series/${series.id}`}>
              {series.artworkUrl && <img src={series.artworkUrl} alt="" />}
              <h2>{series.name}</h2>
            </Link>
            {series.description && <p>{series.description}</p>}
          </article>
        ))}
      </section>
    </main>
  );
}
