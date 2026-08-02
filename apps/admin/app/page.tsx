"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse, SeatInput } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { MenuManager } from "./menu-manager";
import { ManagementDashboard } from "./management-dashboard";
import { ManagementControls } from "./management-controls";
import { SchedulingCalendar, type CalendarShowtime } from "./scheduling-calendar";

interface Auditorium {
  id: string; name: string; capacity: number;
  seatMap: { seats: SeatMapSeat[] } | null;
}
interface Movie { id: string; title: string; runtimeMinutes: number; }
interface Showtime {
  id: string; startsAt: string; featureStartsAt: string; endsAt: string; roomReadyAt: string; onSale: boolean;
  movie: Movie; auditorium: Auditorium;
}
interface Bootstrap {
  location: {
    id: string; name: string; preShowBufferMinutes: number; cleaningBufferMinutes: number;
    auditoriums: Auditorium[]; organization: { movies: Movie[] };
  };
  showtimes: Showtime[];
}

function buildSeats(rows: number, seatsPerRow: number): SeatInput[] {
  return Array.from({ length: rows }, (_, rowIndex) => {
    const rowLabel = String.fromCharCode(65 + rowIndex);
    return Array.from({ length: seatsPerRow }, (_, seatIndex) => {
      const number = seatIndex + 1;
      const accessible = rowIndex === rows - 1 && seatIndex < 2;
      return {
        label: `${rowLabel}${number}`, rowLabel, number, x: seatIndex, y: rowIndex,
        type: accessible ? (seatIndex === 0 ? "ADA" as const : "COMPANION" as const) : "STANDARD" as const,
        tableGroupId: `${rowLabel}-${Math.floor(seatIndex / 2) + 1}`,
        tablePosition: seatIndex % 2 === 0 ? ("LEFT" as const) : ("RIGHT" as const),
      };
    });
  }).flat();
}

export default function AdminPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("Theater 1");
  const [rows, setRows] = useState(8);
  const [seatsPerRow, setSeatsPerRow] = useState(12);
  const [movieTitle, setMovieTitle] = useState("");
  const [runtime, setRuntime] = useState(120);
  const [movieId, setMovieId] = useState("");
  const [auditoriumId, setAuditoriumId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [onSale, setOnSale] = useState(true);
  const [editingShowtimeId, setEditingShowtimeId] = useState<string | null>(null);
  const [showtimeEditorOpen, setShowtimeEditorOpen] = useState(false);

  const previewSeats = useMemo(() => buildSeats(rows, seatsPerRow), [rows, seatsPerRow]);

  async function refresh(accessToken = token) {
    if (!accessToken) return;
    const response = await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken });
    setData(response);
    setMovieId((current) => current || response.location.organization.movies[0]?.id || "");
    setAuditoriumId((current) => current || response.location.auditoriums[0]?.id || "");
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

  async function createAuditorium(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await apiFetch("/cinema/auditoriums", {
        accessToken: token ?? undefined, method: "POST",
        body: JSON.stringify({ name: roomName, seatMapName: `${roomName} paired seating`, seats: previewSeats }),
      });
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function createMovie(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await apiFetch("/cinema/movies", {
        accessToken: token ?? undefined, method: "POST",
        body: JSON.stringify({ title: movieTitle, runtimeMinutes: runtime }),
      });
      setMovieTitle(""); await refresh();
    } catch (reason) { showError(reason); }
  }

  async function createShowtime(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await apiFetch(editingShowtimeId ? `/cinema/showtimes/${editingShowtimeId}` : "/cinema/showtimes", {
        accessToken: token ?? undefined, method: editingShowtimeId ? "PATCH" : "POST",
        body: JSON.stringify({ movieId, auditoriumId, startsAt: new Date(startsAt).toISOString(), onSale }),
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
    setShowtimeEditorOpen(true);
  }

  function createShowtimeAt(auditorium: string, date: Date) {
    const local = new Date(date);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    setEditingShowtimeId(null);
    setAuditoriumId(auditorium);
    setStartsAt(local.toISOString().slice(0, 16));
    setOnSale(false);
    setShowtimeEditorOpen(true);
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
    <section className="stats">
      <div><strong>{data?.location.auditoriums.length ?? 0}</strong><span>Auditoriums</span></div>
      <div><strong>{data?.location.organization.movies.length ?? 0}</strong><span>Movies</span></div>
      <div><strong>{data?.showtimes.length ?? 0}</strong><span>Showtimes</span></div>
      <div><strong>30 + 15</strong><span>Pre-show + cleaning</span></div>
    </section>

    {data && <SchedulingCalendar
      auditoriums={data.location.auditoriums}
      showtimes={data.showtimes}
      preShowBufferMinutes={data.location.preShowBufferMinutes}
      cleaningBufferMinutes={data.location.cleaningBufferMinutes}
      onCreate={createShowtimeAt}
      onEdit={editShowtime}
    />}

    {showtimeEditorOpen && <div className="editor-backdrop" role="presentation" onMouseDown={() => setShowtimeEditorOpen(false)}>
      <form className="showtime-drawer" id="showtime-editor" onSubmit={createShowtime} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-heading">
          <div><p className="kicker">SHOWTIME</p><h2>{editingShowtimeId ? "Edit showing" : "Add showing"}</h2></div>
          <button type="button" className="drawer-close" onClick={() => setShowtimeEditorOpen(false)} aria-label="Close showtime editor">×</button>
        </div>
        <label>Movie<select required value={movieId} onChange={(e) => setMovieId(e.target.value)}><option value="">Select</option>{data?.location.organization.movies.map((movie) => <option key={movie.id} value={movie.id}>{movie.title} · {movie.runtimeMinutes}m</option>)}</select></label>
        <label>Auditorium<select required value={auditoriumId} onChange={(e) => setAuditoriumId(e.target.value)}><option value="">Select</option>{data?.location.auditoriums.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.capacity} seats</option>)}</select></label>
        <label>Advertised start<input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <div className="calculation-note">Attend automatically adds {data?.location.preShowBufferMinutes ?? 30} minutes of pre-show, the film runtime, and {data?.location.cleaningBufferMinutes ?? 15} minutes of cleaning.</div>
        <label className="checkbox"><input type="checkbox" checked={onSale} onChange={(e) => setOnSale(e.target.checked)} /> Open for sale</label>
        <button className="primary">{editingShowtimeId ? "Save changes" : "Add to schedule"}</button>
        <button type="button" className="secondary" onClick={() => setShowtimeEditorOpen(false)}>Cancel</button>
      </form>
    </div>}

    <details className="setup-disclosure">
      <summary><span><b>Cinema setup</b><small>Add movies or configure auditoriums</small></span><span>Open setup</span></summary>
      <section className="admin-grid setup-grid">
      <form className="panel" onSubmit={createAuditorium}>
        <p className="kicker">01 · AUDITORIUM</p><h2>Structured seat layout</h2>
        <label>Name<input required value={roomName} onChange={(e) => setRoomName(e.target.value)} /></label>
        <div className="two-fields">
          <label>Rows<input type="number" min="1" max="20" value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
          <label>Seats per row<input type="number" min="2" max="30" step="2" value={seatsPerRow} onChange={(e) => setSeatsPerRow(Number(e.target.value))} /></label>
        </div>
        <SeatMap seats={previewSeats} label={`${roomName} preview`} />
        <button className="primary">Create {rows * seatsPerRow}-seat auditorium</button>
      </form>

      <div className="stack">
        <form className="panel" onSubmit={createMovie}>
          <p className="kicker">02 · MOVIE</p><h2>Add a movie</h2>
          <label>Title<input required value={movieTitle} onChange={(e) => setMovieTitle(e.target.value)} /></label>
          <label>Runtime in minutes<input type="number" min="1" max="600" value={runtime} onChange={(e) => setRuntime(Number(e.target.value))} /></label>
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
