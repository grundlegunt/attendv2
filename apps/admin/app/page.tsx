"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AuthenticatedEmployee,
  AuthTokenResponse,
  CreateMovieSchema,
  MovieResponse,
  MovieStatus,
} from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

interface AuditEventRow {
  id: string;
  action: string;
  entityType: string;
  actorType: string;
  occurredAt: string;
}

interface MovieFormState {
  title: string;
  rating: string;
  runtimeMinutes: string;
  synopsis: string;
  posterImageUrl: string;
  status: MovieStatus;
}

const EMPTY_MOVIE: MovieFormState = {
  title: "",
  rating: "",
  runtimeMinutes: "",
  synopsis: "",
  posterImageUrl: "",
  status: "COMING_SOON",
};

export default function AdminPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [movies, setMovies] = useState<MovieResponse[]>([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string | null>(null);
  const [movieForm, setMovieForm] = useState<MovieFormState>(EMPTY_MOVIE);
  const [movieFormError, setMovieFormError] = useState<string | null>(null);
  const [movieSaving, setMovieSaving] = useState(false);

  const canManageMovies = employee?.permissions.includes("movie.manage") ?? false;

  useEffect(() => {
    if (!accessToken) return;

    setMoviesError(null);
    setMoviesLoading(true);
    apiFetch<MovieResponse[]>("/movies", { accessToken })
      .then(setMovies)
      .catch((requestError) => {
        setMoviesError(errorMessage(requestError, "Failed to load movies."));
      })
      .finally(() => setMoviesLoading(false));

    setAuditError(null);
    apiFetch<AuditEventRow[]>("/audit-events?limit=10", { accessToken })
      .then(setAuditEvents)
      .catch((requestError) => {
        setAuditError(errorMessage(requestError, "Failed to load recent audit activity."));
      });
  }, [accessToken]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>(
        "/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setEmployee(response.employee);
      setAccessToken(response.accessToken);
    } catch (requestError) {
      setError(errorMessage(requestError, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMovie(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setMovieFormError(null);

    const parsed = CreateMovieSchema.safeParse({
      ...movieForm,
      runtimeMinutes: Number(movieForm.runtimeMinutes),
    });
    if (!parsed.success) {
      setMovieFormError(parsed.error.issues[0]?.message ?? "Check the movie details and try again.");
      return;
    }

    setMovieSaving(true);
    try {
      const created = await apiFetch<MovieResponse>("/movies", {
        accessToken,
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setMovies((current) => [...current, created].sort((a, b) => a.title.localeCompare(b.title)));
      setMovieForm(EMPTY_MOVIE);
    } catch (requestError) {
      setMovieFormError(errorMessage(requestError, "Failed to create the movie."));
    } finally {
      setMovieSaving(false);
    }
  }

  if (!employee) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1>Manager Sign In</h1>
          <p className="subtitle">Theater management &amp; reporting</p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={handleLogin}>
            <Field label="Email" id="email">
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" id="password">
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <h1>Movies</h1>
          <p>Signed in as {employee.name} ({employee.roles.join(", ")})</p>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>Movie catalog</h2>
          {moviesError && <div className="error-banner">{moviesError}</div>}
          {moviesLoading ? (
            <p className="muted">Loading movies…</p>
          ) : movies.length === 0 ? (
            <div className="empty-state">No movies yet. Create the first title for this organization.</div>
          ) : (
            <div className="movie-list">
              {movies.map((movie) => (
                <article className="movie-row" key={movie.id}>
                  <div>
                    <h3>{movie.title}</h3>
                    <p>{movie.rating || "Not rated"} · {movie.runtimeMinutes} minutes</p>
                  </div>
                  <span className="status-badge">{movie.status.replaceAll("_", " ")}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Create movie</h2>
          {!canManageMovies ? (
            <div className="empty-state">Your role does not include the movie.manage permission.</div>
          ) : (
            <form onSubmit={handleCreateMovie}>
              {movieFormError && <div className="error-banner">{movieFormError}</div>}
              <Field label="Title" id="movie-title">
                <input
                  id="movie-title"
                  required
                  maxLength={200}
                  value={movieForm.title}
                  onChange={(e) => setMovieForm({ ...movieForm, title: e.target.value })}
                />
              </Field>
              <div className="field-row">
                <Field label="Rating" id="movie-rating">
                  <input
                    id="movie-rating"
                    maxLength={20}
                    placeholder="PG-13"
                    value={movieForm.rating}
                    onChange={(e) => setMovieForm({ ...movieForm, rating: e.target.value })}
                  />
                </Field>
                <Field label="Runtime (minutes)" id="movie-runtime">
                  <input
                    id="movie-runtime"
                    type="number"
                    min={1}
                    max={1440}
                    required
                    value={movieForm.runtimeMinutes}
                    onChange={(e) => setMovieForm({ ...movieForm, runtimeMinutes: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Status" id="movie-status">
                <select
                  id="movie-status"
                  value={movieForm.status}
                  onChange={(e) => setMovieForm({ ...movieForm, status: e.target.value as MovieStatus })}
                >
                  <option value="COMING_SOON">Coming soon</option>
                  <option value="NOW_PLAYING">Now playing</option>
                  <option value="SPECIAL_EVENT">Special event</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </Field>
              <Field label="Poster image URL" id="movie-poster">
                <input
                  id="movie-poster"
                  type="url"
                  maxLength={2048}
                  placeholder="https://…"
                  value={movieForm.posterImageUrl}
                  onChange={(e) => setMovieForm({ ...movieForm, posterImageUrl: e.target.value })}
                />
              </Field>
              <Field label="Synopsis" id="movie-synopsis">
                <textarea
                  id="movie-synopsis"
                  rows={5}
                  maxLength={5000}
                  value={movieForm.synopsis}
                  onChange={(e) => setMovieForm({ ...movieForm, synopsis: e.target.value })}
                />
              </Field>
              <button className="primary" type="submit" disabled={movieSaving}>
                {movieSaving ? "Creating movie…" : "Create movie"}
              </button>
            </form>
          )}
        </section>
      </div>

      {(auditError || auditEvents.length > 0) && (
        <section className="panel audit-panel">
          <h2>Recent audit activity</h2>
          {auditError && <div className="error-banner">{auditError}</div>}
          {auditEvents.length > 0 && (
            <table className="audit-table">
              <thead><tr><th>Action</th><th>Entity</th><th>Actor</th><th>When</th></tr></thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.action}</td><td>{event.entityType}</td><td>{event.actorType}</td>
                    <td>{new Date(event.occurredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}</div>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.body.message : fallback;
}
