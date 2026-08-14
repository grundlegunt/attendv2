"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SeatMapLayout } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { SchedulingCalendar, type CalendarShowtime } from "../scheduling-calendar";
import { useAdminSession, useAdminUi } from "../admin-session";

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
  detailPosterUrl?: string | null;
  posterPosition?: "TOP" | "CENTER" | "BOTTOM";
  detailPosterPosition?: "TOP" | "CENTER" | "BOTTOM";
  diningSpecialArtworkUrl?: string | null;
  diningSpecialTitle?: string | null;
  director?: string | null; starring?: string | null; trailerUrl?: string | null; releaseYear?: number | null;
  pairings?: Array<{ menuItemId: string; sortOrder: number }>;
}
interface PriceTier { id: string; name: string; ticketPriceMinor: number; feeMinor: number; currency: string; }
interface FilmSeries { id: string; name: string; description?: string | null; artworkUrl?: string | null; active: boolean; }
interface Showtime {
  id: string; startsAt: string; featureStartsAt: string; endsAt: string; roomReadyAt: string; onSale: boolean;
  filmSeries: FilmSeries | null; presentation: "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
  format?: string | null;
  movie: Movie; auditorium: Auditorium; priceTier: PriceTier;
}
interface ShowtimeSeatInventory {
  seats: Array<Omit<SeatMapSeat, "state"> & { state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" }>;
  counts: { available: number; held: number; sold: number; blocked: number };
}
interface Bootstrap {
  location: {
    id: string; name: string; preShowBufferMinutes: number; cleaningBufferMinutes: number;
    auditoriums: Auditorium[]; organization: { movies: Movie[]; priceTiers: PriceTier[]; filmSeries: FilmSeries[] };
    menuCategories: Array<{ id: string; name: string; items: Array<{ id: string; name: string; imageUrl?: string | null }> }>;
  };
  showtimes: Showtime[];
  archivedMovies: Movie[];
}

function dateTimeInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AdminPage() {
  const { employee, accessToken: token } = useAdminSession();
  const adminUi = useAdminUi();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState("");
  const [runtime, setRuntime] = useState(120);
  const [movieSynopsis, setMovieSynopsis] = useState("");
  const [movieRating, setMovieRating] = useState("");
  const [moviePosterUrl, setMoviePosterUrl] = useState("");
  const [movieDetailPosterUrl, setMovieDetailPosterUrl] = useState("");
  const [moviePosterPosition, setMoviePosterPosition] = useState<"TOP" | "CENTER" | "BOTTOM">("CENTER");
  const [movieDetailPosterPosition, setMovieDetailPosterPosition] = useState<"TOP" | "CENTER" | "BOTTOM">("CENTER");
  const [movieDiningSpecialArtworkUrl, setMovieDiningSpecialArtworkUrl] = useState("");
  const [movieDiningSpecialTitle, setMovieDiningSpecialTitle] = useState("");
  const [movieDirector, setMovieDirector] = useState("");
  const [movieStarring, setMovieStarring] = useState("");
  const [movieTrailerUrl, setMovieTrailerUrl] = useState("");
  const [movieReleaseYear, setMovieReleaseYear] = useState<number | "">("");
  const [pairingMenuItemIds, setPairingMenuItemIds] = useState<string[]>([]);
  const [pairingMenuSearch, setPairingMenuSearch] = useState("");
  const [editingMovieId, setEditingMovieId] = useState<string | null>(null);
  const [movieId, setMovieId] = useState("");
  const [auditoriumId, setAuditoriumId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [onSale, setOnSale] = useState(true);
  const [priceTierId, setPriceTierId] = useState("");
  const [filmSeriesId, setFilmSeriesId] = useState("");
  const [presentation, setPresentation] = useState<"STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST">("STANDARD");
  const [showtimeFormat, setShowtimeFormat] = useState("");
  const [editingShowtimeId, setEditingShowtimeId] = useState<string | null>(null);
  const [showtimeEditorOpen, setShowtimeEditorOpen] = useState(false);
  const [linkedShowtimeHandled, setLinkedShowtimeHandled] = useState(false);
  const [movieEditorOpen, setMovieEditorOpen] = useState(false);
  const [seatInventory, setSeatInventory] = useState<ShowtimeSeatInventory | null>(null);
  const [seatInventoryError, setSeatInventoryError] = useState<string | null>(null);

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

  const linkedMovieId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("movieId");
  const linkedShowtimeId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("showtimeId");

  async function createMovie(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await apiFetch(editingMovieId ? `/cinema/movies/${editingMovieId}` : "/cinema/movies", {
        accessToken: token ?? undefined, method: editingMovieId ? "PATCH" : "POST",
        body: JSON.stringify({
          title: movieTitle,
          runtimeMinutes: runtime,
          synopsis: movieSynopsis.trim() || null,
          rating: movieRating.trim() || null,
          posterUrl: moviePosterUrl.trim() || null,
          detailPosterUrl: movieDetailPosterUrl.trim() || null,
          posterPosition: moviePosterPosition,
          detailPosterPosition: movieDetailPosterPosition,
          diningSpecialArtworkUrl: movieDiningSpecialArtworkUrl.trim() || null,
          diningSpecialTitle: movieDiningSpecialTitle.trim() || null,
          director: movieDirector.trim() || null,
          starring: movieStarring.trim() || null,
          trailerUrl: movieTrailerUrl.trim() || null,
          releaseYear: movieReleaseYear === "" ? null : movieReleaseYear,
          pairingMenuItemIds,
        }),
      });
      setMovieTitle("");
      setMovieSynopsis("");
      setMovieRating("");
      setMoviePosterUrl("");
      setMovieDetailPosterUrl("");
      setMoviePosterPosition("CENTER");
      setMovieDetailPosterPosition("CENTER");
      setMovieDiningSpecialArtworkUrl("");
      setMovieDiningSpecialTitle("");
      setMovieDirector(""); setMovieStarring(""); setMovieTrailerUrl(""); setMovieReleaseYear(""); setPairingMenuItemIds([]);
      setPairingMenuSearch("");
      setEditingMovieId(null);
      setMovieEditorOpen(false);
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function archiveMovie(movie: Movie) {
    if (!window.confirm(`Remove ${movie.title} (${movie.runtimeMinutes} min) from the film library? Existing showtime and sales history will be preserved.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/movies/${movie.id}`, { accessToken: token ?? undefined, method: "DELETE" });
      if (movieId === movie.id) setMovieId("");
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function restoreMovie(movie: Movie) {
    setError(null);
    try {
      await apiFetch(`/cinema/movies/${movie.id}/restore`, { accessToken: token ?? undefined, method: "POST" });
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function permanentlyDeleteMovie(movie: Movie) {
    if (!window.confirm(`Permanently delete ${movie.title}? This cannot be undone.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/movies/${movie.id}/permanent`, { accessToken: token ?? undefined, method: "DELETE" });
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function duplicateDay(sourceDate: string, targetDates: string[], saleStatus: "PRESERVE" | "DRAFT" | "ON_SALE") {
    setError(null);
    await apiFetch<{ createdCount: number }>("/cinema/showtimes/duplicate-day", {
      accessToken: token ?? undefined,
      method: "POST",
      body: JSON.stringify({ sourceDate, targetDates, saleStatus }),
    });
    await refresh();
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
          filmSeriesId: filmSeriesId || null,
          presentation,
          format: showtimeFormat.trim() || null,
        }),
      });
      setEditingShowtimeId(null);
      setShowtimeEditorOpen(false);
      await refresh();
    } catch (reason) { showError(reason); }
  }

  function editShowtime(showtime: CalendarShowtime) {
    const local = new Date(showtime.startsAt);
    setEditingShowtimeId(showtime.id);
    setMovieId(showtime.movie.id);
    setAuditoriumId(showtime.auditorium.id);
    setStartsAt(dateTimeInputValue(local));
    setOnSale(showtime.onSale);
    setPriceTierId(showtime.priceTier.id);
    setFilmSeriesId(showtime.filmSeries?.id ?? "");
    setPresentation(showtime.presentation ?? "STANDARD");
    setShowtimeFormat(showtime.format ?? "");
    setShowtimeEditorOpen(true);
  }

  useEffect(() => {
    if (!showtimeEditorOpen || !editingShowtimeId) {
      setSeatInventory(null);
      setSeatInventoryError(null);
      return;
    }
    let canceled = false;
    setSeatInventory(null);
    setSeatInventoryError(null);
    apiFetch<ShowtimeSeatInventory>(`/cinema/showtimes/${editingShowtimeId}/seats`)
      .then((inventory) => { if (!canceled) setSeatInventory(inventory); })
      .catch(() => { if (!canceled) setSeatInventoryError("Seat inventory could not be loaded."); });
    return () => { canceled = true; };
  }, [editingShowtimeId, showtimeEditorOpen]);

  useEffect(() => {
    if (!data || !linkedShowtimeId || linkedShowtimeHandled) return;
    const showtime = data.showtimes.find((candidate) => candidate.id === linkedShowtimeId);
    if (showtime) editShowtime(showtime);
    setLinkedShowtimeHandled(true);
  }, [data, linkedShowtimeHandled, linkedShowtimeId]);

  function createShowtimeAt(auditorium: string, date: Date, selectedMovieId?: string) {
    const local = new Date(date);
    setEditingShowtimeId(null);
    setMovieId(selectedMovieId ?? "");
    setAuditoriumId(auditorium);
    setStartsAt(dateTimeInputValue(local));
    setOnSale(true);
    setPriceTierId("");
    setFilmSeriesId("");
    setPresentation("STANDARD");
    setShowtimeFormat("");
    setShowtimeEditorOpen(true);
  }

  async function quickCreateShowtime(auditorium: string, date: Date, selectedMovieId: string) {
    setError(null);
    try {
      await apiFetch("/cinema/showtimes", {
        accessToken: token ?? undefined,
        method: "POST",
        body: JSON.stringify({
          movieId: selectedMovieId,
          auditoriumId: auditorium,
          startsAt: date.toISOString(),
          onSale: true,
          presentation: "STANDARD",
        }),
      });
      await refresh();
    } catch (reason) { showError(reason); }
  }

  function shiftShowtime(minutes: number) {
    if (!startsAt) return;
    const next = new Date(startsAt);
    next.setMinutes(next.getMinutes() + minutes);
    setStartsAt(dateTimeInputValue(next));
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
    } catch (reason) { showError(reason); }
  }

  async function removeShowtime() {
    if (!editingShowtimeId) return;
    const label = selectedMovie?.title ?? "this showtime";
    if (!window.confirm(`Remove ${label} from the schedule? This is only allowed for a future showing with no ticket, hold, or restaurant activity.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/showtimes/${editingShowtimeId}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
      });
      setEditingShowtimeId(null);
      setShowtimeEditorOpen(false);
      await refresh();
    } catch (reason) { showError(reason); }
  }

  async function quickRemoveShowtime(showtime: CalendarShowtime) {
    if (!window.confirm(`Remove ${showtime.movie.title} from the schedule? This is only allowed for a future showing with no ticket, hold, or restaurant activity.`)) return;
    setError(null);
    try {
      await apiFetch(`/cinema/showtimes/${showtime.id}`, {
        accessToken: token ?? undefined,
        method: "DELETE",
      });
      if (editingShowtimeId === showtime.id) {
        setEditingShowtimeId(null);
        setShowtimeEditorOpen(false);
      }
      await refresh();
    } catch (reason) { showError(reason); }
  }

  const selectedMovie = data?.location.organization.movies.find((movie) => movie.id === movieId);
  const selectedRoom = data?.location.auditoriums.find((room) => room.id === auditoriumId);
  const diningSpecialPreviewTitle = movieDiningSpecialTitle.trim() || data?.location.menuCategories
    .flatMap((category) => category.items)
    .filter((item) => pairingMenuItemIds.includes(item.id))
    .map((item) => item.name)
    .join(" & ") || "Dining special headline";
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
    } catch (reason) {
      showError(reason);
    }
  }

  async function moveManyShowtimes(moves: Array<{ showtime: CalendarShowtime; auditoriumId: string; startsAt: Date }>) {
    setError(null);
    try {
      await apiFetch("/cinema/showtimes/group", {
        accessToken: token ?? undefined,
        method: "PATCH",
        body: JSON.stringify({ moves: moves.map(({ showtime, auditoriumId, startsAt }) => ({ showtimeId: showtime.id, auditoriumId, startsAt: startsAt.toISOString() })) }),
      });
      await refresh();
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
    setMovieDetailPosterUrl(movie?.detailPosterUrl ?? "");
    setMoviePosterPosition(movie?.posterPosition ?? "CENTER");
    setMovieDetailPosterPosition(movie?.detailPosterPosition ?? "CENTER");
    setMovieDiningSpecialArtworkUrl(movie?.diningSpecialArtworkUrl ?? "");
    setMovieDiningSpecialTitle(movie?.diningSpecialTitle ?? "");
    setMovieDirector(movie?.director ?? "");
    setMovieStarring(movie?.starring ?? "");
    setMovieTrailerUrl(movie?.trailerUrl ?? "");
    setMovieReleaseYear(movie?.releaseYear ?? "");
    setPairingMenuItemIds(movie?.pairings?.map((pairing) => pairing.menuItemId) ?? []);
    setPairingMenuSearch("");
    setMovieEditorOpen(true);
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

    {data && <div className={`schedule-with-inspector ${showtimeEditorOpen ? "inspector-open" : ""}`}><SchedulingCalendar
      labels={adminUi.labels}
      locationName={data.location.name}
      auditoriums={data.location.auditoriums}
      movies={data.location.organization.movies}
      archivedMovies={data.archivedMovies}
      initialSelectedMovieId={linkedMovieId}
      showtimes={data.showtimes}
      preShowBufferMinutes={data.location.preShowBufferMinutes}
      cleaningBufferMinutes={Math.max(15, data.location.cleaningBufferMinutes)}
      onCreate={createShowtimeAt}
      onQuickCreate={quickCreateShowtime}
      onEdit={editShowtime}
      onRemoveShowtime={quickRemoveShowtime}
      onMove={moveShowtime}
      onMoveMany={moveManyShowtimes}
      onAddMovie={() => openMovieEditor()}
      onEditMovie={openMovieEditor}
      onArchiveMovie={archiveMovie}
      onRestoreMovie={restoreMovie}
      onDeleteMovie={permanentlyDeleteMovie}
      onDuplicateDay={duplicateDay}
    />

    {showtimeEditorOpen && <aside className="schedule-inspector" aria-label="Selected showtime">
      <form id="showtime-editor" onSubmit={createShowtime}>
        <div className="drawer-heading">
          <div><p className="kicker">SELECTED SHOWTIME</p><h2>{selectedMovie?.title ?? (editingShowtimeId ? "Edit showing" : "Add showing")}</h2>{selectedRoom && <p className="inspector-room">{selectedRoom.name} · {selectedRoom.capacity} seats</p>}</div>
          <button type="button" className="drawer-close" onClick={() => setShowtimeEditorOpen(false)} aria-label="Close showtime editor">×</button>
        </div>
        <div className="showtime-inspector-summary">
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
        {editingShowtimeId && <section className="showtime-seat-inventory" aria-label="Showtime seat inventory">
          <div className="showtime-seat-inventory-heading"><strong>Seat inventory</strong>{seatInventory && <span>{seatInventory.counts.sold}/{seatInventory.seats.length} sold</span>}</div>
          {seatInventory ? <>
            <div className="seat-inventory-counts">
              <span><b>{seatInventory.counts.available}</b> available</span>
              <span><b>{seatInventory.counts.sold}</b> sold</span>
              <span><b>{seatInventory.counts.held}</b> held</span>
              <span><b>{seatInventory.counts.blocked}</b> blocked</span>
            </div>
            <SeatMap seats={seatInventory.seats.map((seat) => ({ ...seat, state: seat.state === "AVAILABLE" ? "available" : "unavailable" }))} label="Read-only showtime seat inventory" />
            <p className="sold-seat-labels"><strong>Purchased seats</strong><span>{seatInventory.seats.filter((seat) => seat.state === "SOLD").map((seat) => seat.label).join(", ") || "None"}</span></p>
          </> : seatInventoryError ? <p className="inline-error">{seatInventoryError}</p> : <p className="seat-inventory-loading">Loading seat inventory…</p>}
        </section>}
        </div>
        <div className="showtime-inspector-fields">
        <label>Movie<select required value={movieId} onChange={(e) => setMovieId(e.target.value)}><option value="">Select</option>{data.location.organization.movies.map((movie) => <option key={movie.id} value={movie.id}>{movie.title} · {movie.runtimeMinutes}m</option>)}</select></label>
        <label>Move to room<select required value={auditoriumId} onChange={(e) => setAuditoriumId(e.target.value)}><option value="">Select</option>{data.location.auditoriums.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.capacity} seats</option>)}</select></label>
        <div className="showtime-time-editor"><label>Doors / advertised time<input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label><div className="time-nudges" aria-label="Adjust showtime"><button type="button" onClick={() => shiftShowtime(-15)}>−15</button><button type="button" onClick={() => shiftShowtime(-5)}>−5</button><button type="button" onClick={() => shiftShowtime(5)}>+5</button><button type="button" onClick={() => shiftShowtime(15)}>+15</button></div></div>
        <label>Sale status<select value={onSale ? "open" : "draft"} onChange={(event) => setOnSale(event.target.value === "open")}><option value="open">Open for sale</option><option value="draft">Closed draft</option></select></label>
        <label>Ticket group<select value={priceTierId} onChange={(event) => setPriceTierId(event.target.value)}><option value="">Automatic for show date</option>{data.location.organization.priceTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name} · {new Intl.NumberFormat("en-US", { style: "currency", currency: tier.currency }).format(tier.ticketPriceMinor / 100)}</option>)}</select></label>
        <label>Film series<select value={filmSeriesId} onChange={(event) => setFilmSeriesId(event.target.value)}><option value="">Regular engagement</option>{data.location.organization.filmSeries.filter((series) => series.active).map((series) => <option key={series.id} value={series.id}>{series.name}</option>)}</select></label>
        <label>Presentation<select value={presentation} onChange={(event) => setPresentation(event.target.value as typeof presentation)}><option value="STANDARD">Standard</option><option value="OPEN_CAPTIONS">Open captions</option><option value="Q_AND_A">Q&amp;A</option><option value="SPECIAL_GUEST">Special guest</option></select></label>
        <label>Screening format<input value={showtimeFormat} onChange={(event) => setShowtimeFormat(event.target.value)} placeholder="DCP, 35mm, 70mm…" /></label>
        </div>
        <div className="calculation-note">Attend includes {data.location.preShowBufferMinutes} minutes of pre-show, the film runtime, and at least 15 minutes of cleaning. Conflicting placements are rejected.</div>
        <div className="showtime-inspector-actions">
        <button className="primary">{editingShowtimeId ? "Save changes" : "Add to schedule"}</button>
        {editingShowtimeId && <button type="button" className={onSale ? "sale-action close-sale" : "sale-action open-sale"} onClick={() => void changeSaleStatus()}>{onSale ? "Close sales" : "Open sales"}</button>}
        {editingShowtimeId && <button type="button" className="secondary destructive-outline" onClick={() => void removeShowtime()}>Remove from schedule</button>}
        <button type="button" className="secondary" onClick={() => setShowtimeEditorOpen(false)}>Close</button>
        </div>
      </form>
    </aside>}</div>}

    {movieEditorOpen && <div className="editor-backdrop" role="presentation" onMouseDown={() => setMovieEditorOpen(false)}>
      <form className="showtime-drawer" onSubmit={createMovie} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-heading">
          <div><p className="kicker">FILM LIBRARY</p><h2>{editingMovieId ? "Edit film" : "Add a film"}</h2></div>
          <button type="button" className="drawer-close" onClick={() => setMovieEditorOpen(false)} aria-label="Close film editor">×</button>
        </div>
        <label>Title<input required autoFocus value={movieTitle} onChange={(event) => setMovieTitle(event.target.value)} /></label>
        <label>Runtime in minutes<input type="number" min="1" max="600" value={runtime} onChange={(event) => setRuntime(Number(event.target.value))} /></label>
        <label>Rating<input value={movieRating} onChange={(event) => setMovieRating(event.target.value)} placeholder="PG, PG-13, R…" /></label>
        <label>Showtimes artwork URL<input type="text" value={moviePosterUrl} onChange={(event) => setMoviePosterUrl(event.target.value)} placeholder="Landscape image used on film cards" /></label>
        <label>Showtimes artwork framing<select value={moviePosterPosition} onChange={(event) => setMoviePosterPosition(event.target.value as typeof moviePosterPosition)}><option value="TOP">Top</option><option value="CENTER">Center</option><option value="BOTTOM">Bottom</option></select></label>
        <label>Movie detail poster URL<input type="text" value={movieDetailPosterUrl} onChange={(event) => setMovieDetailPosterUrl(event.target.value)} placeholder="Vertical one-sheet used on the film page" /></label>
        <label>Detail poster framing<select value={movieDetailPosterPosition} onChange={(event) => setMovieDetailPosterPosition(event.target.value as typeof movieDetailPosterPosition)}><option value="TOP">Top</option><option value="CENTER">Center</option><option value="BOTTOM">Bottom</option></select></label>
        <label>Dining special artwork URL<input type="text" value={movieDiningSpecialArtworkUrl} onChange={(event) => setMovieDiningSpecialArtworkUrl(event.target.value)} placeholder="Single photo showing the paired food and drink" /></label>
        <label>Dining special headline<input maxLength={120} value={movieDiningSpecialTitle} onChange={(event) => setMovieDiningSpecialTitle(event.target.value)} placeholder="Optional short promotional name shown over the photo" /></label>
        {(moviePosterUrl || movieDetailPosterUrl || movieDiningSpecialArtworkUrl) && <div className="movie-artwork-previews" aria-label="Film artwork previews">
          {moviePosterUrl && <figure><img src={moviePosterUrl} alt="" style={{ objectPosition: moviePosterPosition.toLowerCase() }} /><figcaption>Showtimes card</figcaption></figure>}
          {movieDetailPosterUrl && <figure className="movie-artwork-preview--poster"><img src={movieDetailPosterUrl} alt="" style={{ objectPosition: movieDetailPosterPosition.toLowerCase() }} /><figcaption>Movie detail poster</figcaption></figure>}
          {movieDiningSpecialArtworkUrl && <figure><div className="movie-special-card-preview"><img src={movieDiningSpecialArtworkUrl} alt="" /><div><strong>{diningSpecialPreviewTitle}</strong><span>{movieTitle || "Movie title"}</span></div></div><figcaption>Dining special · combined food &amp; drink</figcaption></figure>}
        </div>}
        <label>Director<input value={movieDirector} onChange={(event) => setMovieDirector(event.target.value)} /></label>
        <label>Starring<input value={movieStarring} onChange={(event) => setMovieStarring(event.target.value)} placeholder="Comma-separated cast" /></label>
        <label>Trailer URL<input type="url" value={movieTrailerUrl} onChange={(event) => setMovieTrailerUrl(event.target.value)} placeholder="https://…" /></label>
        <label>Release year<input type="number" min="1888" max="2200" value={movieReleaseYear} onChange={(event) => setMovieReleaseYear(event.target.value ? Number(event.target.value) : "")} /></label>
        <label>Synopsis<textarea rows={6} value={movieSynopsis} onChange={(event) => setMovieSynopsis(event.target.value)} placeholder="Short customer-facing film description" /></label>
        <fieldset className="pairing-picker"><legend>Paired food &amp; drink</legend><div className="pairing-picker__heading"><p>Choose the menu items featured with this film.</p><span>{pairingMenuItemIds.length} selected</span></div>
          <div className="pairing-picker__controls"><input type="search" value={pairingMenuSearch} onChange={(event) => setPairingMenuSearch(event.target.value)} placeholder="Search food, drinks, or categories" aria-label="Search paired menu items" />{pairingMenuItemIds.length > 0 && <button type="button" onClick={() => setPairingMenuItemIds([])}>Clear</button>}</div>
          <div className="pairing-picker__grid">{data?.location.menuCategories.flatMap((category) => category.items.filter((item) => `${item.name} ${category.name}`.toLocaleLowerCase().includes(pairingMenuSearch.trim().toLocaleLowerCase())).map((item) => {
          const selected = pairingMenuItemIds.includes(item.id);
          return <label className="pairing-option" data-selected={selected || undefined} key={item.id}>
            <input type="checkbox" checked={selected} onChange={(event) => setPairingMenuItemIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
            {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="pairing-option__placeholder" aria-hidden="true">{item.name.slice(0, 1)}</span>}
            <span className="pairing-option__copy"><strong>{item.name}</strong><small>{category.name}</small></span>
            <span className="pairing-option__check" aria-hidden="true">✓</span>
          </label>;
        }))}</div></fieldset>
        <button className="primary">{editingMovieId ? "Save film" : "Add to film library"}</button>
        <button type="button" className="secondary" onClick={() => setMovieEditorOpen(false)}>Cancel</button>
      </form>
    </div>}

  </main>;
}
