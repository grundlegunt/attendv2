"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse, SeatMapLayout } from "@cinema/shared";
import type { SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { AuditoriumBuilder } from "./auditorium-builder";
import { MenuManager } from "./menu-manager";
import { ManagementDashboard } from "./management-dashboard";
import { ManagementControls } from "./management-controls";
import { SchedulingCalendar, type CalendarShowtime } from "./scheduling-calendar";

interface Auditorium {
  id: string; name: string; capacity: number;
  seatMap: { id: string; name: string; version: number; layoutJson: SeatMapLayout | null; seats: Array<SeatMapSeat & { rowLabel: string; number: number; levelKey?: string | null; sectionKey?: string | null }> } | null;
}
interface Movie {
  id: string;
  title: string;
  runtimeMinutes: number;
  synopsis?: string | null;
  rating?: string | null;
  posterUrl?: string | null;
}
interface PriceTier { id: string; name: string; ticketPriceMinor: number; feeMinor: number; currency: string; }
interface Showtime {
  id: string; startsAt: string; featureStartsAt: string; endsAt: string; roomReadyAt: string; onSale: boolean;
  filmSeries: string | null; presentation: "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
  movie: Movie; auditorium: Auditorium; priceTier?: PriceTier | null;
}
interface Bootstrap {
  location: {
    id: string; name: string; preShowBufferMinutes: number; cleaningBufferMinutes: number;
    auditoriums: Auditorium[]; organization: { movies: Movie[]; priceTiers: PriceTier[] };
  };
  showtimes: Showtime[];
}

export default function AdminPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState("");
  const [runtime, setRuntime] = useState(120);
  const [movieSynopsis, setMovieSynopsis] = useState("");
  const [movieRating, setMovieRating] = useState("");
  const [moviePosterUrl, setMoviePosterUrl] = useState("");
  const [editingMovieId, setEditingMovieId] = useState<string | null>(null);
  const [movieId, setMovieId] = useState("");
  const [auditoriumId, setAuditoriumId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [onSale, setOnSale] = useState(true);
  const [priceTierId, setPriceTierId] = useState("");
  const [filmSeries, setFilmSeries] = useState("");
  const [presentation, setPresentation] = useState<"STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST">("STANDARD");
  const [editingShowtimeId, setEditingShowtimeId] = useState<string | null>(null);
  const [showtimeEditorOpen, setShowtimeEditorOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [movieEditorOpen, setMovieEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(accessToken = token) {
    if (!accessToken) return;
    const response = await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken });
    setData(response);
    setMovieId((current) => current || response.location.organization.movies[0]?.id || "");
    setAuditoriumId((current) => current || response.location.auditoriums[0]?.id || "");
    setPriceTierId((current) => current || response.location.organization.priceTiers[0]?.id || "");
  }

  useEffect(() => { refresh().catch(showError); }, [token]);
  function showError(reason: unknown) {
    setError(reason instanceof ApiRequestError ? reason.body.message : "The request could not be completed.");
  }

  async function login(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const response = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/login", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      setEmployee(response.employee); setToken(response.accessToken);
    } catch (reason) { showError(reason); }
  }

  async function createMovie(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const addedTitle = movieTitle;
      await apiFetch(editingMovieId ? `/cinema/movies/${editingMovieId}` : "/cinema/movies", {
        accessToken: token ?? undefined, method: editingMovieId ? "PATCH" : "POST",
        body: JSON.stringify({
          title: movieTitle,
          runtimeMinutes: runtime,
          synopsis: movieSynopsis.trim() || null,
          rating: movieRating.trim() || null,
          posterUrl: moviePosterUrl.trim() || null,
        }),
      });
      setMovieTitle("");
      setMovieSynopsis("");
      setMovieRating("");
      setMoviePosterUrl("");
      setEditingMovieId(null);
      setMovieEditorOpen(false);
      await refresh();
      setNotice(`${addedTitle} was ${editingMovieId ? "updated" : "added to the film library"}.`);
    } catch (reason) { showError(reason); }
  }

  async function archiveMovie(movie: Movie) {
    if (!window.confirm(`Remove ${movie.title} (${movie.runtimeMinutes} min) from the film library? Existing showtime and sales history will be preserved.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/movies/${movie.id}`, { accessToken: token ?? undefined, method: "DELETE" });
      if (movieId === movie.id) setMovieId("");
      await refresh();
      setNotice(`${movie.title} was removed from the film library. Historical records were preserved.`);
    } catch (reason) { showError(reason); }
  }

  async function createShowtime(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await apiFetch(editingShowtimeId ? `/cinema/showtimes/${editingShowtimeId}` : "/cinema/showtimes", {
        accessToken: token ?? undefined, method: editingShowtimeId ? "PATCH" : "POST",
        body: JSON.stringify({
          movieId,
          auditoriumId,
          priceTierId: priceTierId || undefined,
          startsAt: new Date(startsAt).toISOString(),
          onSale,
          filmSeries: filmSeries.trim() || null,
          presentation,
        }),
      });
      setEditingShowtimeId(null);
      setShowtimeEditorOpen(false);
      await refresh();
    } catch (reason) { showError(reason); }
  }

  function editShowtime(showtime: CalendarShowtime) {
    const local = new Date(showtime.startsAt);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    setEditingShowtimeId(showtime.id);
    setMovieId(showtime.movie.id);
    setAuditoriumId(showtime.auditorium.id);
    setStartsAt(local.toISOString().slice(0, 16));
    setOnSale(showtime.onSale);
    setPriceTierId(showtime.priceTier?.id ?? data?.location.organization.priceTiers[0]?.id ?? "");
    setFilmSeries(showtime.filmSeries ?? "");
    setPresentation(showtime.presentation ?? "STANDARD");
    setShowtimeEditorOpen(true);
  }

  function createShowtimeAt(auditorium: string, date: Date, selectedMovieId?: string) {
    const local = new Date(date);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    setEditingShowtimeId(null);
    if (selectedMovieId) setMovieId(selectedMovieId);
    setAuditoriumId(auditorium);
    setStartsAt(local.toISOString().slice(0, 16));
    setOnSale(false);
    setPriceTierId(data?.location.organization.priceTiers[0]?.id ?? "");
    setFilmSeries("");
    setPresentation("STANDARD");
    setShowtimeEditorOpen(true);
  }

  function shiftShowtime(minutes: number) {
    if (!startsAt) return;
    const next = new Date(startsAt);
    next.setMinutes(next.getMinutes() + minutes);
    next.setMinutes(next.getMinutes() - next.getTimezoneOffset());
    setStartsAt(next.toISOString().slice(0, 16));
  }

  async function changeSaleStatus() {
    if (!editingShowtimeId) return;
    setError(null);
    try {
      const nextOnSale = !onSale;
      await apiFetch(`/cinema/showtimes/${editingShowtimeId}`, {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({ onSale: nextOnSale }),
      });
      setOnSale(nextOnSale);
      await refresh();
      setNotice(nextOnSale ? "Ticket sales are now open." : "Ticket sales are now closed. The showtime remains on the schedule.");
    } catch (reason) { showError(reason); }
  }

  const selectedMovie = data?.location.organization.movies.find((movie) => movie.id === movieId);
  const selectedRoom = data?.location.auditoriums.find((room) => room.id === auditoriumId);
  const selectedTiming = useMemo(() => {
    if (!startsAt || !selectedMovie || !data) return null;
    const doors = new Date(startsAt);
    const feature = new Date(doors.getTime() + data.location.preShowBufferMinutes * 60000);
    const ends = new Date(feature.getTime() + selectedMovie.runtimeMinutes * 60000);
    const ready = new Date(ends.getTime() + Math.max(15, data.location.cleaningBufferMinutes) * 60000);
    return { doors, feature, ends, ready };
  }, [data, selectedMovie, startsAt]);

  function displayTime(value: Date) {
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  async function moveShowtime(showtime: CalendarShowtime, nextAuditoriumId: string, nextStartsAt: Date) {
    setError(null);
    try {
      await apiFetch(`/cinema/showtimes/${showtime.id}`, {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({
          movieId: showtime.movie.id,
          auditoriumId: nextAuditoriumId,
          startsAt: nextStartsAt.toISOString(),
          onSale: showtime.onSale,
        }),
      });
      await refresh();
      setNotice(`${showtime.movie.title} moved to ${nextStartsAt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`);
    } catch (reason) {
      showError(reason);
    }
  }

  function openMovieEditor(movie?: Movie) {
    setEditingMovieId(movie?.id ?? null);
    setMovieTitle(movie?.title ?? "");
    setRuntime(movie?.runtimeMinutes ?? 120);
    setMovieSynopsis(movie?.synopsis ?? "");
    setMovieRating(movie?.rating ?? "");
    setMoviePosterUrl(movie?.posterUrl ?? "");
    setMovieEditorOpen(true);
  }

  if (!employee) {
    return <main className="admin-shell login-shell"><form className="panel login-panel" onSubmit={login}>
      <p className="kicker">ATTEND ADMIN</p><h1>Manager sign in</h1>
      {error && <div className="error-banner">{error}</div>}
      <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="primary">Sign in</button>
    </form></main>;
  }

  return <main className="admin-shell">
    <header><div><p className="kicker">ATTEND · CINEMA CONFIG</p><h1>{data?.location.name ?? "Loading…"}</h1></div><span>{employee.name}</span></header>
    {error && <div className="error-banner">{error}</div>}
    {notice && <button type="button" className="status-toast" onClick={() => setNotice(null)}>{notice}<span>×</span></button>}
    <section className="stats">
      <div><strong>{data?.location.auditoriums.length ?? 0}</strong><span>Auditoriums</span></div>
      <div><strong>{data?.location.organization.movies.length ?? 0}</strong><span>Movies</span></div>
      <div><strong>{data?.showtimes.length ?? 0}</strong><span>Showtimes</span></div>
      <div><strong>30 + 15</strong><span>Pre-show + cleaning</span></div>
    </section>

    {data && <div className="schedule-with-inspector"><SchedulingCalendar
      locationName={data.location.name}
      auditoriums={data.location.auditoriums}
      movies={data.location.organization.movies}
      showtimes={data.showtimes}
      preShowBufferMinutes={data.location.preShowBufferMinutes}
      cleaningBufferMinutes={Math.max(15, data.location.cleaningBufferMinutes)}
      onCreate={createShowtimeAt}
      onEdit={editShowtime}
      onMove={moveShowtime}
      onAddMovie={() => openMovieEditor()}
      onEditMovie={openMovieEditor}
      onArchiveMovie={archiveMovie}
    />

    <aside className="schedule-inspector" aria-label="Selected showtime">
      {showtimeEditorOpen ? <form id="showtime-editor" onSubmit={createShowtime}>
        <div className="drawer-heading">
          <div><p className="kicker">SELECTED SHOWTIME</p><h2>{selectedMovie?.title ?? (editingShowtimeId ? "Edit showing" : "Add showing")}</h2>{selectedRoom && <p className="inspector-room">{selectedRoom.name} · {selectedRoom.capacity} seats</p>}</div>
          <button type="button" className="drawer-close" onClick={() => setShowtimeEditorOpen(false)} aria-label="Close showtime editor">×</button>
        </div>
        {selectedTiming && <div className="timing-summary">
          <div><span>Doors / listed time</span><strong>{displayTime(selectedTiming.doors)}</strong></div>
          <div><span>Feature starts</span><strong>{displayTime(selectedTiming.feature)}</strong></div>
          <div><span>Film ends</span><strong>{displayTime(selectedTiming.ends)}</strong></div>
          <div><span>Room ready</span><strong>{displayTime(selectedTiming.ready)}</strong></div>
        </div>}
        {selectedMovie && <div className="selected-film-details">
          {selectedMovie.posterUrl ? <img src={selectedMovie.posterUrl} alt={`${selectedMovie.title} poster`} /> : <div className="poster-placeholder">No poster</div>}
          <div>
            <strong>{selectedMovie.title}</strong>
            <span>{selectedMovie.rating || "Not rated"} · {selectedMovie.runtimeMinutes} min</span>
            <button type="button" className="film-details-button" onClick={() => openMovieEditor(selectedMovie)}>Edit film details &amp; poster URL</button>
          </div>
        </div>}
        <label>Movie<select required value={movieId} onChange={(e) => setMovieId(e.target.value)}><option value="">Select</option>{data.location.organization.movies.map((movie) => <option key={movie.id} value={movie.id}>{movie.title} · {movie.runtimeMinutes}m</option>)}</select></label>
        <label>Move to room<select required value={auditoriumId} onChange={(e) => setAuditoriumId(e.target.value)}><option value="">Select</option>{data.location.auditoriums.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.capacity} seats</option>)}</select></label>
        <label>Doors / advertised time<input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <div className="time-nudges" aria-label="Adjust showtime"><button type="button" onClick={() => shiftShowtime(-15)}>−15 min</button><button type="button" onClick={() => shiftShowtime(-5)}>−5 min</button><button type="button" onClick={() => shiftShowtime(5)}>+5 min</button><button type="button" onClick={() => shiftShowtime(15)}>+15 min</button></div>
        <label>Sale status<select value={onSale ? "open" : "draft"} onChange={(event) => setOnSale(event.target.value === "open")}><option value="open">Open for sale</option><option value="draft">Closed draft</option></select></label>
        <label>Ticket group<select value={priceTierId} onChange={(event) => setPriceTierId(event.target.value)}>{data.location.organization.priceTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name} · {new Intl.NumberFormat("en-US", { style: "currency", currency: tier.currency }).format(tier.ticketPriceMinor / 100)}</option>)}</select></label>
        <label>Film series<input value={filmSeries} onChange={(event) => setFilmSeries(event.target.value)} placeholder="Optional, e.g. Summer Classics" /></label>
        <label>Presentation<select value={presentation} onChange={(event) => setPresentation(event.target.value as typeof presentation)}><option value="STANDARD">Standard</option><option value="OPEN_CAPTIONS">Open captions</option><option value="Q_AND_A">Q&amp;A</option><option value="SPECIAL_GUEST">Special guest</option></select></label>
        <div className="calculation-note">Attend includes {data.location.preShowBufferMinutes} minutes of pre-show, the film runtime, and at least 15 minutes of cleaning. Conflicting placements are rejected.</div>
        <ul className="timing-rules"><li>✓ {data.location.preShowBufferMinutes} minutes for doors, ordering, and trailers</li><li>✓ Film runtime begins at feature start</li><li>✓ 15-minute cleaning gap is enforced automatically</li></ul>
        <button className="primary">{editingShowtimeId ? "Save changes" : "Add to schedule"}</button>
        {editingShowtimeId && <button type="button" className={onSale ? "sale-action close-sale" : "sale-action open-sale"} onClick={() => void changeSaleStatus()}>{onSale ? "Close sales" : "Open sales"}</button>}
        <button type="button" className="secondary" onClick={() => setShowtimeEditorOpen(false)}>Close</button>
      </form> : <div className="inspector-empty"><p className="kicker">SELECTED SHOWTIME</p><h2>Choose a showing</h2><p>Select a block—or click an open time—to edit it here without leaving the calendar.</p></div>}
    </aside></div>}

    {movieEditorOpen && <div className="editor-backdrop" role="presentation" onMouseDown={() => setMovieEditorOpen(false)}>
      <form className="showtime-drawer" onSubmit={createMovie} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-heading">
          <div><p className="kicker">FILM LIBRARY</p><h2>{editingMovieId ? "Edit film" : "Add a film"}</h2></div>
          <button type="button" className="drawer-close" onClick={() => setMovieEditorOpen(false)} aria-label="Close film editor">×</button>
        </div>
        <label>Title<input required autoFocus value={movieTitle} onChange={(event) => setMovieTitle(event.target.value)} /></label>
        <label>Runtime in minutes<input type="number" min="1" max="600" value={runtime} onChange={(event) => setRuntime(Number(event.target.value))} /></label>
        <label>Rating<input value={movieRating} onChange={(event) => setMovieRating(event.target.value)} placeholder="PG, PG-13, R…" /></label>
        <label>Poster URL<input type="text" value={moviePosterUrl} onChange={(event) => setMoviePosterUrl(event.target.value)} placeholder="https://… or /posters/film.png" /></label>
        <label>Synopsis<textarea rows={6} value={movieSynopsis} onChange={(event) => setMovieSynopsis(event.target.value)} placeholder="Short customer-facing film description" /></label>
        <button className="primary">{editingMovieId ? "Save film" : "Add to film library"}</button>
        <button type="button" className="secondary" onClick={() => setMovieEditorOpen(false)}>Cancel</button>
      </form>
    </div>}

    <details className="setup-disclosure" open={setupOpen} onToggle={(event) => setSetupOpen(event.currentTarget.open)}>
      <summary><span><b>Cinema setup</b><small>Add movies or configure auditoriums</small></span><span>Open setup</span></summary>
      <section className="admin-grid setup-grid">
      {token && <AuditoriumBuilder
        accessToken={token}
        auditoriums={data?.location.auditoriums ?? []}
        onError={showError}
        onSaved={async (message) => { await refresh(); setNotice(message); }}
      />}

      <div className="stack">
        <form className="panel" id="movie-setup" onSubmit={createMovie}>
          <p className="kicker">02 · MOVIE</p><h2>Add a movie</h2>
          <label>Title<input required value={movieTitle} onChange={(e) => setMovieTitle(e.target.value)} /></label>
          <label>Runtime in minutes<input type="number" min="1" max="600" value={runtime} onChange={(e) => setRuntime(Number(e.target.value))} /></label>
          <label>Rating<input value={movieRating} onChange={(event) => setMovieRating(event.target.value)} /></label>
          <label>Poster URL<input value={moviePosterUrl} onChange={(event) => setMoviePosterUrl(event.target.value)} /></label>
          <label>Synopsis<textarea rows={4} value={movieSynopsis} onChange={(event) => setMovieSynopsis(event.target.value)} /></label>
          <button className="primary">Add movie</button>
        </form>
      </div>
      </section>
    </details>
    {token && <MenuManager accessToken={token} />}
    {token && <ManagementDashboard accessToken={token} permissions={employee.permissions} />}
    {token && <ManagementControls accessToken={token} permissions={employee.permissions} />}
  </main>;
}
