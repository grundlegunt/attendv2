"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface FilmSeries {
  id: string;
  name: string;
  description: string | null;
  artworkUrl: string | null;
  sortOrder: number;
  active: boolean;
}

interface Bootstrap {
  location: {
    name: string;
    organization: { filmSeries: FilmSeries[] };
  };
}

export default function FilmSeriesPage() {
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
        body: JSON.stringify({ name, description: seriesDescription.trim() || null, artworkUrl: seriesArtworkUrl.trim() || null }),
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
    } catch (reason) {
      showError(reason);
    }
  }

  async function moveSeries(series: FilmSeries, direction: -1 | 1) {
    if (!accessToken) return;
    const currentIndex = activeSeries.findIndex((entry) => entry.id === series.id);
    const other = activeSeries[currentIndex + direction];
    if (!other) return;
    setError(null);
    setNotice(null);
    try {
      await Promise.all([
        apiFetch(`/cinema/film-series/${series.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ sortOrder: other.sortOrder }) }),
        apiFetch(`/cinema/film-series/${other.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ sortOrder: series.sortOrder }) }),
      ]);
      await refresh();
      setNotice(`${series.name} display order updated.`);
    } catch (reason) {
      showError(reason);
    }
  }

  const activeSeries = (data?.location.organization.filmSeries ?? []).filter((series) => series.active);

  return <main>
    <section className="admin-heading">
      <div><p className="kicker">PROGRAMMING GROUPS</p><h1>Film Series &amp; Special Events</h1><p>Create and maintain customer-facing programming groups, then assign them to individual showtimes from Scheduling.</p></div>
    </section>
    {error && <div className="error">{error}{error.startsWith("Your admin session expired") && <button type="button" className="secondary" onClick={signOut}>Sign in again</button>}</div>}
    {notice && <div className="notice">{notice}</div>}
    <section className="film-series-manager" aria-labelledby="film-series-heading">
      <div className="film-series-intro">
        <p className="kicker">{data?.location.name ?? "CINEMA PROGRAMMING"}</p>
        <h2 id="film-series-heading">Series catalog</h2>
        <p>Use series for recurring programs, repertory runs, director retrospectives, and special events.</p>
      </div>
      <form className="film-series-form" onSubmit={saveSeries}>
        <label>Name<input required value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="Summer Classics" /></label>
        <label>Description<textarea rows={4} value={seriesDescription} onChange={(event) => setSeriesDescription(event.target.value)} placeholder="Customer-facing description of the series or event" /></label>
        <label>Artwork URL<input value={seriesArtworkUrl} onChange={(event) => setSeriesArtworkUrl(event.target.value)} placeholder="https://…" /></label>
        <div className="film-series-form-actions"><button className="primary" disabled={seriesSaving}>{seriesSaving ? (editingSeriesId ? "Saving…" : "Creating…") : (editingSeriesId ? "Save series" : "Add series")}</button>{editingSeriesId && <button type="button" className="secondary" onClick={resetSeriesForm} disabled={seriesSaving}>Cancel</button>}</div>
      </form>
      <div className="film-series-list">
        {activeSeries.map((series, index) => <article key={series.id}>
          {series.artworkUrl ? <img src={series.artworkUrl} alt="" /> : <div className="series-artwork-placeholder">Series</div>}
          <div><h3>{series.name}</h3><p>{series.description || "No description added."}</p></div>
          <div className="film-series-row-actions"><button type="button" onClick={() => void moveSeries(series, -1)} disabled={index === 0} aria-label={`Move ${series.name} up`}>↑</button><button type="button" onClick={() => void moveSeries(series, 1)} disabled={index === activeSeries.length - 1} aria-label={`Move ${series.name} down`}>↓</button><button type="button" onClick={() => editSeries(series)}>Edit</button><button type="button" className="destructive-outline" onClick={() => void archiveSeries(series)}>Archive</button></div>
        </article>)}
        {data && activeSeries.length === 0 && <p className="builder-help">No film series yet. Add one here, then assign it to showtimes from Scheduling.</p>}
      </div>
    </section>
  </main>;
}
