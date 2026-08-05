"use client";

import Link from "next/link";
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

interface FilmSeries { id: string; name: string; description: string | null; artworkUrl: string | null; active: boolean; }
interface Bootstrap {
  location: { id: string; name: string; auditoriums: Auditorium[]; organization: { filmSeries: FilmSeries[] } };
}

export default function CinemaSetupPage() {
  const { accessToken, signOut } = useAdminSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seriesName, setSeriesName] = useState("");
  const [seriesDescription, setSeriesDescription] = useState("");
  const [seriesArtworkUrl, setSeriesArtworkUrl] = useState("");
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [seriesSaving, setSeriesSaving] = useState(false);

  async function refresh() {
    if (!accessToken) return;
    setData(await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }));
  }

  useEffect(() => { refresh().catch(showError); }, [accessToken]);

  function showError(reason: unknown) {
    if (reason instanceof ApiRequestError && reason.status === 401) {
      setError("Your admin session expired. Sign in again, then retry the action.");
      return;
    }
    setError(reason instanceof ApiRequestError ? reason.body.message : "The request could not be completed.");
  }

  function resetSeriesForm() {
    setEditingSeriesId(null);
    setSeriesName("");
    setSeriesDescription("");
    setSeriesArtworkUrl("");
  }

  function editSeries(series: FilmSeries) {
    setEditingSeriesId(series.id);
    setSeriesName(series.name);
    setSeriesDescription(series.description ?? "");
    setSeriesArtworkUrl(series.artworkUrl ?? "");
  }

  async function saveSeries(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const name = seriesName.trim();
    if (!name) {
      setError("Enter a name for the film series.");
      return;
    }
    if (!accessToken) {
      setError("Sign in again before adding a film series.");
      return;
    }
    setSeriesSaving(true);
    try {
      await apiFetch(editingSeriesId ? `/cinema/film-series/${editingSeriesId}` : "/cinema/film-series", {
        accessToken,
        method: editingSeriesId ? "PATCH" : "POST",
        body: JSON.stringify({
          name,
          description: seriesDescription.trim() || null,
          artworkUrl: seriesArtworkUrl.trim() || null,
        }),
      });
      const action = editingSeriesId ? "updated" : "created";
      resetSeriesForm();
      await refresh();
      setNotice(`Film series ${action}. It is now available when scheduling a showtime.`);
    } catch (reason) {
      showError(reason);
    } finally {
      setSeriesSaving(false);
    }
  }

  async function archiveSeries(series: FilmSeries) {
    if (!window.confirm(`Archive ${series.name}? Existing showtimes will keep their series history.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/film-series/${series.id}`, { accessToken: accessToken ?? undefined, method: "DELETE" });
      if (editingSeriesId === series.id) resetSeriesForm();
      await refresh();
      setNotice(`${series.name} was archived. Existing showtime history was preserved.`);
    } catch (reason) { showError(reason); }
  }

  return <main>
    <section className="admin-heading">
      <div><p className="kicker">LOCATION CONFIGURATION</p><h1>Cinema Setup</h1><p>Choose a location, then build and maintain its auditoriums and seat maps.</p></div>
    </section>
    {error && <div className="error">{error}{error.startsWith("Your admin session expired") && <button type="button" className="secondary" onClick={signOut}>Sign in again</button>}</div>}
    {notice && <div className="notice">{notice}</div>}
    <section className="cinema-setup-workspace">
      <aside className="setup-location-rail" aria-label="Locations">
        <div className="setup-rail-heading"><p className="kicker">LOCATIONS</p><Link href="/location">Manage</Link></div>
        {data?.location ? <button className="setup-location-card active" type="button">
          <strong>{data.location.name}</strong>
          <span>{data.location.auditoriums.length} {data.location.auditoriums.length === 1 ? "auditorium" : "auditoriums"}</span>
        </button> : <p className="builder-help">Loading your location…</p>}
        <p className="setup-scope-note">Locations shown here follow your staff access. Multi-location staff will be able to switch between every assigned cinema.</p>
      </aside>
      {accessToken && <AuditoriumBuilder
          accessToken={accessToken}
          auditoriums={data?.location.auditoriums ?? []}
          onError={showError}
          onSaved={async (message) => { await refresh(); setNotice(message); }}
        />}
    </section>
    <section className="film-series-manager" aria-labelledby="film-series-heading">
      <div className="film-series-intro">
        <p className="kicker">PROGRAMMING GROUPS</p>
        <h2 id="film-series-heading">Film Series &amp; Special Events</h2>
        <p>Create reusable programming groups such as Summer Classics, Midnight Movies, or Director Retrospectives. Assign them to individual showtimes from Scheduling.</p>
      </div>
      <form className="film-series-form" onSubmit={saveSeries}>
        <label>Name<input required value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="Summer Classics" /></label>
        <label>Description<textarea rows={4} value={seriesDescription} onChange={(event) => setSeriesDescription(event.target.value)} placeholder="Customer-facing description of the series or event" /></label>
        <label>Artwork URL<input value={seriesArtworkUrl} onChange={(event) => setSeriesArtworkUrl(event.target.value)} placeholder="https://…" /></label>
        <div className="film-series-form-actions"><button className="primary" disabled={seriesSaving}>{seriesSaving ? (editingSeriesId ? "Saving…" : "Creating…") : (editingSeriesId ? "Save series" : "Add series")}</button>{editingSeriesId && <button type="button" className="secondary" onClick={resetSeriesForm} disabled={seriesSaving}>Cancel</button>}</div>
      </form>
      <div className="film-series-list">
        {(data?.location.organization.filmSeries ?? []).filter((series) => series.active).map((series) => <article key={series.id}>
          {series.artworkUrl ? <img src={series.artworkUrl} alt="" /> : <div className="series-artwork-placeholder">Series</div>}
          <div><h3>{series.name}</h3><p>{series.description || "No description added."}</p></div>
          <div className="film-series-row-actions"><button type="button" onClick={() => editSeries(series)}>Edit</button><button type="button" className="destructive-outline" onClick={() => void archiveSeries(series)}>Archive</button></div>
        </article>)}
        {data && !data.location.organization.filmSeries.some((series) => series.active) && <p className="builder-help">No film series yet. Add one here, then assign it to showtimes from Scheduling.</p>}
      </div>
    </section>
  </main>;
}
