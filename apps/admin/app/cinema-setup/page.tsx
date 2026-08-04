"use client";

import { FormEvent, useEffect, useState } from "react";
import type { SeatMapLayout } from "@cinema/shared";
import type { SeatMapSeat } from "@cinema/ui";
import { AuditoriumBuilder } from "../auditorium-builder";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface Auditorium {
  id: string;
  name: string;
  capacity: number;
  seatMap: {
    id: string;
    name: string;
    version: number;
    layoutJson: SeatMapLayout | null;
    seats: Array<SeatMapSeat & {
      rowLabel: string;
      number: number;
      levelKey?: string | null;
      sectionKey?: string | null;
    }>;
  } | null;
}

interface Bootstrap {
  location: { name: string; auditoriums: Auditorium[] };
}

export default function CinemaSetupPage() {
  const { accessToken } = useAdminSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState("");
  const [runtime, setRuntime] = useState(120);
  const [rating, setRating] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [synopsis, setSynopsis] = useState("");

  async function refresh() {
    if (!accessToken) return;
    setData(await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }));
  }

  useEffect(() => { refresh().catch(showError); }, [accessToken]);

  function showError(reason: unknown) {
    setError(reason instanceof ApiRequestError ? reason.body.message : "The request could not be completed.");
  }

  async function createMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/cinema/movies", {
        accessToken: accessToken ?? undefined,
        method: "POST",
        body: JSON.stringify({
          title: movieTitle,
          runtimeMinutes: runtime,
          rating: rating.trim() || null,
          posterUrl: posterUrl.trim() || null,
          synopsis: synopsis.trim() || null,
        }),
      });
      setMovieTitle("");
      setRuntime(120);
      setRating("");
      setPosterUrl("");
      setSynopsis("");
      setNotice("Movie added to the film library.");
    } catch (reason) { showError(reason); }
  }

  return <main>
    <section className="admin-heading">
      <div><p className="kicker">LOCATION CONFIGURATION</p><h1>Cinema Setup</h1><p>Build auditoriums and maintain the films available for scheduling.</p></div>
    </section>
    {error && <div className="error">{error}</div>}
    {notice && <div className="notice">{notice}</div>}
    <section className="admin-grid setup-grid">
      {accessToken && <AuditoriumBuilder
        accessToken={accessToken}
        auditoriums={data?.location.auditoriums ?? []}
        onError={showError}
        onSaved={async (message) => { await refresh(); setNotice(message); }}
      />}
      <div className="stack">
        <form className="panel" onSubmit={createMovie}>
          <p className="kicker">02 · FILM LIBRARY</p><h2>Add a movie</h2>
          <label>Title<input required value={movieTitle} onChange={(event) => setMovieTitle(event.target.value)} /></label>
          <label>Runtime in minutes<input type="number" min="1" max="600" value={runtime} onChange={(event) => setRuntime(Number(event.target.value))} /></label>
          <label>Rating<input value={rating} onChange={(event) => setRating(event.target.value)} placeholder="PG, PG-13, R…" /></label>
          <label>Poster URL<input value={posterUrl} onChange={(event) => setPosterUrl(event.target.value)} placeholder="https://…" /></label>
          <label>Synopsis<textarea rows={5} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} /></label>
          <button className="primary">Add movie</button>
        </form>
      </div>
    </section>
  </main>;
}
