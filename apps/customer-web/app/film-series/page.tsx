"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicFilmSeries } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { useCinemaContent } from "../components/customer-branding";

interface FilmSeriesResponse {
  location: { id: string; name: string; timezone: string };
  series: PublicFilmSeries[];
}

export default function FilmSeriesPage() {
  const { filmSeries: copy } = useCinemaContent();
  const [program, setProgram] = useState<FilmSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

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

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>
          {copy.intro.replace(
            "{cinema}",
            program?.location.name ?? "the cinema",
          )}
        </p>
      </section>

      {error && <><div className="error-banner">{error}</div><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></>}
      {!program && !error && <p className="loading-copy">{copy.loading}</p>}
      {program && program.series.length === 0 && (
        <p className="loading-copy">{copy.empty}</p>
      )}
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
