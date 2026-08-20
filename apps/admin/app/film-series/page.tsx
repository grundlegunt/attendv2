"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
  const [seriesArtworkError, setSeriesArtworkError] = useState(false);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [seriesSaving, setSeriesSaving] = useState(false);
  const [draggedSeriesId, setDraggedSeriesId] = useState<string | null>(null);
  const [dragOverSeriesId, setDragOverSeriesId] = useState<string | null>(null);
  const createSeriesAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

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
    setSeriesArtworkError(false);
  }

  function editSeries(series: FilmSeries) {
    setEditingSeriesId(series.id);
    setSeriesName(series.name);
    setSeriesDescription(series.description ?? "");
    setSeriesArtworkUrl(series.artworkUrl ?? "");
    setSeriesArtworkError(false);
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
    const body = JSON.stringify({ name, description: seriesDescription.trim() || null, artworkUrl: seriesArtworkUrl.trim() || null });
    if (!editingSeriesId && createSeriesAttemptRef.current?.fingerprint !== body) {
      createSeriesAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    }
    setSeriesSaving(true);
    try {
      await apiFetch(editingSeriesId ? `/cinema/film-series/${editingSeriesId}` : "/cinema/film-series", {
        accessToken,
        method: editingSeriesId ? "PATCH" : "POST",
        ...(!editingSeriesId && createSeriesAttemptRef.current
          ? { headers: { "Idempotency-Key": createSeriesAttemptRef.current.requestId } }
          : {}),
        body,
      });
      createSeriesAttemptRef.current = null;
      const action = editingSeriesId ? "updated" : "created";
      resetSeriesForm();
      await refresh();
      setNotice(`Film series ${action}. It is now available when scheduling a showtime.`);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status < 500) {
        createSeriesAttemptRef.current = null;
      }
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

  async function restoreSeries(series: FilmSeries) {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/cinema/film-series/${series.id}`, {
        accessToken: accessToken ?? undefined,
        method: "PATCH",
        body: JSON.stringify({ active: true }),
      });
      await refresh();
      setNotice(`${series.name} was restored and is available when scheduling showtimes.`);
    } catch (reason) {
      showError(reason);
    }
  }

  async function reorderSeries(targetSeriesId: string) {
    if (!accessToken || !draggedSeriesId || draggedSeriesId === targetSeriesId) return;
    const reordered = [...activeSeries];
    const sourceIndex = reordered.findIndex((entry) => entry.id === draggedSeriesId);
    const targetIndex = reordered.findIndex((entry) => entry.id === targetSeriesId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = reordered.splice(sourceIndex, 1);
    if (!moved) return;
    reordered.splice(targetIndex, 0, moved);
    setError(null);
    setNotice(null);
    try {
      await Promise.all(reordered.map((series, index) => apiFetch(`/cinema/film-series/${series.id}`, {
        accessToken,
        method: "PATCH",
        body: JSON.stringify({ sortOrder: index }),
      })));
      await refresh();
      setNotice(`${moved.name} display order updated.`);
    } catch (reason) {
      showError(reason);
    } finally {
      setDraggedSeriesId(null);
      setDragOverSeriesId(null);
    }
  }

  const activeSeries = (data?.location.organization.filmSeries ?? []).filter((series) => series.active);
  const archivedSeries = (data?.location.organization.filmSeries ?? []).filter((series) => !series.active);

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
        <label>Artwork URL<input type="url" value={seriesArtworkUrl} onChange={(event) => { setSeriesArtworkUrl(event.target.value); setSeriesArtworkError(false); }} placeholder="https://…" /></label>
        {seriesArtworkUrl && <div className={`series-artwork-preview ${seriesArtworkError ? "has-error" : ""}`}>
          {!seriesArtworkError && <img src={seriesArtworkUrl} alt="" onError={() => setSeriesArtworkError(true)} />}
          {seriesArtworkError && <div><strong>Artwork could not be loaded</strong><span>Check the URL before saving.</span></div>}
          <small>Customer-facing series artwork preview</small>
        </div>}
        <div className="film-series-form-actions"><button className="primary" disabled={seriesSaving}>{seriesSaving ? (editingSeriesId ? "Saving…" : "Creating…") : (editingSeriesId ? "Save series" : "Add series")}</button>{editingSeriesId && <button type="button" className="secondary" onClick={resetSeriesForm} disabled={seriesSaving}>Cancel</button>}</div>
      </form>
      <div className="film-series-list">
        {activeSeries.map((series) => <article
          key={series.id}
          draggable
          className={`${draggedSeriesId === series.id ? "dragging" : ""} ${dragOverSeriesId === series.id ? "drag-over" : ""}`.trim()}
          onDragStart={(event) => { setDraggedSeriesId(series.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", series.id); }}
          onDragEnter={() => setDragOverSeriesId(series.id)}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={(event) => { event.preventDefault(); void reorderSeries(series.id); }}
          onDragEnd={() => { setDraggedSeriesId(null); setDragOverSeriesId(null); }}
        >
          {series.artworkUrl ? <img src={series.artworkUrl} alt="" /> : <div className="series-artwork-placeholder">Series</div>}
          <div><h3>{series.name}</h3><p>{series.description || "No description added."}</p></div>
          <div className="film-series-row-actions"><span className="film-series-drag-handle" aria-label={`Drag ${series.name} to reorder`} title="Drag to reorder">⠿</span><button type="button" onClick={() => editSeries(series)}>Edit</button><button type="button" className="destructive-outline" onClick={() => void archiveSeries(series)}>Archive</button></div>
        </article>)}
        {data && activeSeries.length === 0 && <p className="builder-help">No film series yet. Add one here, then assign it to showtimes from Scheduling.</p>}
      </div>
      <details className="archived-films film-series-archive">
        <summary>Archived series <span>{archivedSeries.length}</span></summary>
        <p>Archived series stay attached to historical showtimes and reports.</p>
        {archivedSeries.length ? <div className="archived-film-list">{archivedSeries.map((series) => <div key={series.id}>
          <span><strong>{series.name}</strong><small>{series.description || "No description added."}</small></span>
          <div><button type="button" onClick={() => void restoreSeries(series)}>Restore</button></div>
        </div>)}</div> : <p>No archived series.</p>}
      </details>
    </section>
  </main>;
}
