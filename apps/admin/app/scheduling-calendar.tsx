"use client";

import { useMemo, useState } from "react";
import type { AdminUiConfig } from "@cinema/shared";

import { downloadScheduleWorkbook } from "./schedule-export";

export interface ScheduleAuditorium {
  id: string;
  name: string;
  capacity: number;
}

export interface ScheduleMovie {
  id: string;
  title: string;
  runtimeMinutes: number;
  synopsis?: string | null;
  rating?: string | null;
  posterUrl?: string | null;
}

export interface ScheduleFilmSeries {
  id: string;
  name: string;
  description?: string | null;
  artworkUrl?: string | null;
  active: boolean;
}

export interface CalendarShowtime {
  id: string;
  startsAt: string;
  featureStartsAt: string;
  endsAt: string;
  roomReadyAt: string;
  onSale: boolean;
  filmSeries?: ScheduleFilmSeries | null;
  presentation?: "STANDARD" | "OPEN_CAPTIONS" | "Q_AND_A" | "SPECIAL_GUEST";
  format?: string | null;
  movie: ScheduleMovie;
  auditorium: ScheduleAuditorium;
  priceTier: { id: string; name: string; ticketPriceMinor: number; feeMinor: number; currency: string };
}

interface SchedulingCalendarProps {
  labels: AdminUiConfig["labels"];
  locationName: string;
  auditoriums: ScheduleAuditorium[];
  movies: ScheduleMovie[];
  archivedMovies: ScheduleMovie[];
  initialSelectedMovieId?: string | null;
  showtimes: CalendarShowtime[];
  preShowBufferMinutes: number;
  cleaningBufferMinutes: number;
  onCreate: (auditoriumId: string, startsAt: Date, movieId?: string) => void;
  onQuickCreate: (auditoriumId: string, startsAt: Date, movieId: string) => Promise<void>;
  onEdit: (showtime: CalendarShowtime) => void;
  onRemoveShowtime: (showtime: CalendarShowtime) => Promise<void>;
  onMove: (showtime: CalendarShowtime, auditoriumId: string, startsAt: Date) => Promise<void>;
  onAddMovie: () => void;
  onEditMovie: (movie: ScheduleMovie) => void;
  onArchiveMovie: (movie: ScheduleMovie) => Promise<void>;
  onRestoreMovie: (movie: ScheduleMovie) => Promise<void>;
  onDeleteMovie: (movie: ScheduleMovie) => Promise<void>;
  onDuplicateDay: (sourceDate: string, targetDates: string[], saleStatus: "PRESERVE" | "DRAFT" | "ON_SALE") => Promise<void>;
}

function presentationLabel(presentation: NonNullable<CalendarShowtime["presentation"]>) {
  return {
    STANDARD: "Standard",
    OPEN_CAPTIONS: "Open captions",
    Q_AND_A: "Q&A",
    SPECIAL_GUEST: "Special guest",
  }[presentation];
}

const START_HOUR = 10;
const TOTAL_HOURS = 18;
// Keep the full cinema day visible on a typical manager workstation. Blocks
// remain proportional to runtime, while the inspector stays fixed beside it.
const HOUR_WIDTH = 58;

function startOfCinemaDay(date: Date) {
  const result = new Date(date);
  result.setHours(START_HOUR, 0, 0, 0);
  return result;
}

function dateInputValue(date: Date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function formatTime(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesFrom(start: Date, value: string | Date) {
  return (new Date(value).getTime() - start.getTime()) / 60000;
}

export function SchedulingCalendar({
  labels,
  locationName,
  auditoriums,
  movies,
  archivedMovies,
  initialSelectedMovieId = null,
  showtimes,
  preShowBufferMinutes,
  cleaningBufferMinutes,
  onCreate,
  onQuickCreate,
  onEdit,
  onRemoveShowtime,
  onMove,
  onAddMovie,
  onEditMovie,
  onArchiveMovie,
  onRestoreMovie,
  onDeleteMovie,
  onDuplicateDay,
}: SchedulingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<{ auditoriumId: string; startsAt: Date } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(initialSelectedMovieId);
  const [filmQuery, setFilmQuery] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [duplicateTargets, setDuplicateTargets] = useState<string[]>([]);
  const [duplicateSaleStatus, setDuplicateSaleStatus] = useState<"PRESERVE" | "DRAFT" | "ON_SALE">("PRESERVE");
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const dayStart = useMemo(() => startOfCinemaDay(new Date(`${selectedDate}T12:00:00`)), [selectedDate]);
  const dayEnd = useMemo(() => new Date(dayStart.getTime() + TOTAL_HOURS * 60 * 60000), [dayStart]);
  const now = new Date();

  const visibleShowtimes = useMemo(
    () => showtimes.filter((showtime) => {
      const startsAt = new Date(showtime.startsAt);
      return startsAt >= dayStart && startsAt < dayEnd;
    }),
    [dayEnd, dayStart, showtimes],
  );

  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, index) => {
    const date = new Date(dayStart.getTime() + index * 60 * 60000);
    return { index, label: formatTime(date) };
  });

  function changeDay(days: number) {
    const next = new Date(`${selectedDate}T12:00:00`);
    next.setDate(next.getDate() + days);
    setSelectedDate(dateInputValue(next));
  }

  function roundToFive(date: Date, direction: "nearest" | "up" = "nearest") {
    const interval = 5 * 60000;
    const value = direction === "up" ? Math.ceil(date.getTime() / interval) : Math.round(date.getTime() / interval);
    return new Date(value * interval);
  }

  function availableStart(auditoriumId: string, proposed: Date, durationMinutes: number, ignoredShowtimeId?: string) {
    let candidate = roundToFive(proposed);
    const durationMs = durationMinutes * 60000;
    for (let attempt = 0; attempt <= showtimes.length; attempt += 1) {
      const candidateEnd = candidate.getTime() + durationMs;
      const conflicts = showtimes.filter((showtime) => showtime.id !== ignoredShowtimeId
        && showtime.auditorium.id === auditoriumId
        && candidate.getTime() < new Date(showtime.roomReadyAt).getTime()
        && candidateEnd > new Date(showtime.startsAt).getTime());
      if (!conflicts.length) return candidate;
      candidate = roundToFive(new Date(Math.max(...conflicts.map((showtime) => new Date(showtime.roomReadyAt).getTime()))), "up");
    }
    return candidate;
  }

  function createAtPointer(event: React.MouseEvent<HTMLDivElement>, auditoriumId: string) {
    const target = event.target as HTMLElement;
    if (target.closest(".showtime-block") || target.closest(".drop-preview")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawMinutes = ((event.clientX - bounds.left) / bounds.width) * TOTAL_HOURS * 60;
    const roundedMinutes = Math.max(0, Math.min(TOTAL_HOURS * 60 - 5, Math.round(rawMinutes / 5) * 5));
    const clickedTime = new Date(dayStart.getTime() + roundedMinutes * 60000);
    const previous = visibleShowtimes
      .filter((showtime) => showtime.auditorium.id === auditoriumId && new Date(showtime.startsAt) < clickedTime)
      .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())[0];
    onCreate(auditoriumId, previous ? roundToFive(new Date(previous.roomReadyAt), "up") : clickedTime);
  }

  function timeAtPointer(event: React.DragEvent<HTMLDivElement>, start: Date) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawMinutes = ((event.clientX - bounds.left) / bounds.width) * TOTAL_HOURS * 60;
    const roundedMinutes = Math.max(0, Math.min(TOTAL_HOURS * 60 - 5, Math.round(rawMinutes / 5) * 5));
    return new Date(start.getTime() + roundedMinutes * 60000);
  }

  async function dropOnTimeline(event: React.DragEvent<HTMLDivElement>, auditoriumId: string, start: Date) {
    event.preventDefault();
    const key = event.dataTransfer.getData("text/plain") || draggingKey;
    const targetTime = dropPreview?.auditoriumId === auditoriumId ? dropPreview.startsAt : timeAtPointer(event, start);
    setDraggingKey(null);
    setDropPreview(null);
    if (key?.startsWith("movie:")) {
      const movieId = key.slice("movie:".length);
      const movie = movies.find((item) => item.id === movieId);
      const duration = preShowBufferMinutes + (movie?.runtimeMinutes ?? 90) + cleaningBufferMinutes;
      onCreate(auditoriumId, availableStart(auditoriumId, targetTime, duration), movieId);
      return;
    }
    const showtimeId = key?.startsWith("showtime:") ? key.slice("showtime:".length) : key;
    const showtime = showtimes.find((item) => item.id === showtimeId);
    if (!showtime) return;
    const duration = preShowBufferMinutes + showtime.movie.runtimeMinutes + cleaningBufferMinutes;
    await onMove(showtime, auditoriumId, availableStart(auditoriumId, targetTime, duration, showtime.id));
  }

  async function duplicateAfter(showtime: CalendarShowtime) {
    const duration = preShowBufferMinutes + showtime.movie.runtimeMinutes + cleaningBufferMinutes;
    const startsAt = availableStart(showtime.auditorium.id, new Date(showtime.roomReadyAt), duration);
    await onQuickCreate(showtime.auditorium.id, startsAt, showtime.movie.id);
  }

  async function dropOnWeekRoom(event: React.DragEvent<HTMLDivElement>, auditoriumId: string, targetDay: Date) {
    event.preventDefault();
    const key = event.dataTransfer.getData("text/plain") || draggingKey;
    setDraggingKey(null);
    const showtimeId = key?.startsWith("showtime:") ? key.slice("showtime:".length) : key;
    const showtime = showtimes.find((item) => item.id === showtimeId);
    if (!showtime) return;
    const sourceStart = startOfCinemaDay(new Date(showtime.startsAt));
    if (new Date(showtime.startsAt).getHours() < START_HOUR) sourceStart.setDate(sourceStart.getDate() - 1);
    const offsetMinutes = minutesFrom(sourceStart, showtime.startsAt);
    await onMove(showtime, auditoriumId, new Date(targetDay.getTime() + offsetMinutes * 60000));
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(dayStart);
    date.setDate(date.getDate() + index);
    return date;
  });

  const selectedLibraryMovie = movies.find((movie) => movie.id === selectedMovieId) ?? null;
  const selectedMovieShowtimes = selectedLibraryMovie
    ? showtimes
      .filter((showtime) => showtime.movie.id === selectedLibraryMovie.id)
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
    : [];
  const upcomingMovieShowtimes = selectedMovieShowtimes
    .filter((showtime) => new Date(showtime.startsAt) >= now)
    .slice(0, 6);
  const filmSeries = Array.from(new Map(selectedMovieShowtimes
    .flatMap((showtime) => showtime.filmSeries ? [[showtime.filmSeries.id, showtime.filmSeries] as const] : [])).values());
  const presentations = Array.from(new Set(selectedMovieShowtimes
    .map((showtime) => showtime.presentation ?? "STANDARD")));
  const normalizedFilmQuery = filmQuery.trim().toLocaleLowerCase();
  const filteredMovies = movies.filter((movie) => !normalizedFilmQuery || movie.title.toLocaleLowerCase().includes(normalizedFilmQuery));
  const filteredArchivedMovies = archivedMovies.filter((movie) => !normalizedFilmQuery || movie.title.toLocaleLowerCase().includes(normalizedFilmQuery));

  async function quickAddToSchedule(movie: ScheduleMovie) {
    const dayStart = startOfCinemaDay(new Date(`${selectedDate}T12:00:00`));
    const dayEnd = new Date(dayStart.getTime() + TOTAL_HOURS * 60 * 60000);
    const now = new Date();
    let cursor = dayStart;
    if (dateInputValue(now) === selectedDate && now > dayStart) {
      cursor = new Date(Math.ceil(now.getTime() / (5 * 60000)) * 5 * 60000);
    }
    const durationMs = (preShowBufferMinutes + movie.runtimeMinutes + cleaningBufferMinutes) * 60000;
    for (let startsAt = cursor; startsAt.getTime() + durationMs <= dayEnd.getTime(); startsAt = new Date(startsAt.getTime() + 5 * 60000)) {
      for (const room of auditoriums) {
        const endsAt = startsAt.getTime() + durationMs;
        const conflicts = showtimes.some((showtime) => showtime.auditorium.id === room.id
          && startsAt.getTime() < new Date(showtime.roomReadyAt).getTime()
          && endsAt > new Date(showtime.startsAt).getTime());
        if (!conflicts) {
          await onQuickCreate(room.id, startsAt, movie.id);
          return;
        }
      }
    }
    window.alert(`No open slot is available for ${movie.title} on the selected day.`);
  }

  const draggedShowtime = draggingKey?.startsWith("showtime:")
    ? showtimes.find((showtime) => showtime.id === draggingKey.slice("showtime:".length))
    : undefined;
  const draggedMovie = draggingKey?.startsWith("movie:")
    ? movies.find((movie) => movie.id === draggingKey.slice("movie:".length))
    : draggedShowtime?.movie;
  const resolvedDropPreview = dropPreview && draggedMovie ? {
    auditoriumId: dropPreview.auditoriumId,
    startsAt: availableStart(
      dropPreview.auditoriumId,
      dropPreview.startsAt,
      preShowBufferMinutes + draggedMovie.runtimeMinutes + cleaningBufferMinutes,
      draggedShowtime?.id,
    ),
  } : null;
  const previewAuditorium = resolvedDropPreview
    ? auditoriums.find((auditorium) => auditorium.id === resolvedDropPreview.auditoriumId)
    : undefined;
  const previewLeft = resolvedDropPreview
    ? (minutesFrom(dayStart, resolvedDropPreview.startsAt) / 60) * HOUR_WIDTH
    : 0;

  return <section className="schedule-workspace" aria-label="Showtime scheduling calendar">
    <div className="schedule-toolbar">
      <div>
        <p className="kicker">PROGRAMMING</p>
        <h2>{labels.scheduleTitle}</h2>
        <p>{labels.scheduleInstructions}</p>
      </div>
      <div className="schedule-actions">
        <div className="view-switch" aria-label="Schedule view">
          <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>{labels.day}</button>
          <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>{labels.week}</button>
        </div>
        <button type="button" className="export-schedule-button" disabled={exporting} onClick={async () => {
          setExporting(true);
          try {
            await downloadScheduleWorkbook({ locationName, selectedDate, view, auditoriums, showtimes });
          } finally {
            setExporting(false);
          }
        }}>{exporting ? "Preparing…" : labels.export}</button>
        <button type="button" className="duplicate-day-button" onClick={() => {
          const next = new Date(`${selectedDate}T12:00:00`);
          next.setDate(next.getDate() + 1);
          setDuplicateTarget(dateInputValue(next));
          setDuplicateTargets([]);
          setDuplicateError(null);
          setDuplicateOpen(true);
        }}>{labels.duplicateDay}</button>
      </div>
      <div className="date-controls">
        <button type="button" className="calendar-nav" onClick={() => changeDay(view === "week" ? -7 : -1)} aria-label={`Previous ${view}`}>←</button>
        <button type="button" className="calendar-today" onClick={() => setSelectedDate(dateInputValue(new Date()))}>{labels.today}</button>
        <input aria-label="Schedule date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        <button type="button" className="calendar-nav" onClick={() => changeDay(view === "week" ? 7 : 1)} aria-label={`Next ${view}`}>→</button>
      </div>
    </div>

    <div className="schedule-legend" aria-label="Schedule legend">
      <span><i className="legend-swatch on-sale" /> {labels.onSale}</span>
      <span><i className="legend-swatch draft" /> {labels.draft}</span>
      <span><i className="legend-swatch past" /> {labels.past}</span>
      <span>{preShowBufferMinutes}m pre-show + runtime + {cleaningBufferMinutes}m cleaning</span>
    </div>

    {view === "day" && <div className="calendar-scroll">
      <div className="cinema-calendar" style={{ "--timeline-width": `${TOTAL_HOURS * HOUR_WIDTH}px` } as React.CSSProperties}>
        <div className="calendar-corner"><span>{labels.room}</span></div>
        <div className="time-ruler">
          {hours.map((hour) => <span key={hour.index} style={{ left: `${hour.index * HOUR_WIDTH}px` }}>{hour.label}</span>)}
          {resolvedDropPreview && <output
            className="drag-time-indicator"
            aria-live="polite"
            style={{ left: `${Math.max(74, Math.min(TOTAL_HOURS * HOUR_WIDTH - 74, previewLeft))}px` }}
          >{formatTime(resolvedDropPreview.startsAt)}<small>{previewAuditorium?.name}</small></output>}
        </div>

        {auditoriums.map((auditorium) => {
          const roomShowtimes = visibleShowtimes.filter((showtime) => showtime.auditorium.id === auditorium.id);
          return <div className="calendar-row" key={auditorium.id}>
            <div className="room-label"><strong>{auditorium.name}</strong><span>{auditorium.capacity} seats</span></div>
            <div
              className={`room-timeline ${draggingKey ? "drag-target" : ""}`}
              onDoubleClick={(event) => createAtPointer(event, auditorium.id)}
              onDragOver={(event) => {
                event.preventDefault();
                const startsAt = timeAtPointer(event, dayStart);
                if (dropPreview?.auditoriumId !== auditorium.id || dropPreview.startsAt.getTime() !== startsAt.getTime()) {
                  setDropPreview({ auditoriumId: auditorium.id, startsAt });
                }
              }}
              onDrop={(event) => void dropOnTimeline(event, auditorium.id, dayStart)}
            >
              {hours.slice(0, -1).map((hour) => <i key={hour.index} style={{ left: `${hour.index * HOUR_WIDTH}px` }} />)}
              {draggingKey && resolvedDropPreview?.auditoriumId === auditorium.id && (() => {
                const durationMinutes = preShowBufferMinutes + (draggedMovie?.runtimeMinutes ?? 90) + cleaningBufferMinutes;
                const left = (minutesFrom(dayStart, resolvedDropPreview.startsAt) / 60) * HOUR_WIDTH;
                const width = Math.max(82, (durationMinutes / 60) * HOUR_WIDTH - 8);
                return <div className="drop-preview" style={{ left: `${left + 4}px`, width: `${width}px` }}>
                  <strong>{draggedMovie?.title ?? "Showing"}</strong>
                </div>;
              })()}
              {roomShowtimes.map((showtime) => {
                const startMinutes = Math.max(0, minutesFrom(dayStart, showtime.startsAt));
                const endMinutes = Math.min(TOTAL_HOURS * 60, minutesFrom(dayStart, showtime.roomReadyAt));
                const left = (startMinutes / 60) * HOUR_WIDTH;
                const width = Math.max(82, ((endMinutes - startMinutes) / 60) * HOUR_WIDTH - 8);
                const isPast = new Date(showtime.startsAt) < now;
                const status = isPast ? "past" : showtime.onSale ? "on-sale" : "draft";
                return <div
                  draggable={!isPast}
                  className={`showtime-block-shell ${status}`}
                  key={showtime.id}
                  style={{ left: `${left + 4}px`, width: `${width}px` }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    const key = `showtime:${showtime.id}`;
                    event.dataTransfer.setData("text/plain", key);
                    setDraggingKey(key);
                  }}
                  onDragEnd={() => { setDraggingKey(null); setDropPreview(null); }}
                >
                  <button type="button" className="showtime-block" onClick={(event) => { event.stopPropagation(); onEdit(showtime); }} title={`Edit ${showtime.movie.title}`}>
                  <strong>{showtime.movie.title}</strong>
                  <span>{formatTime(showtime.startsAt)} · Feature {formatTime(showtime.featureStartsAt)}</span>
                  <small>Ready {formatTime(showtime.roomReadyAt)} · {showtime.onSale ? "On sale" : "Draft"}{showtime.filmSeries ? ` · ${showtime.filmSeries.name}` : ""}{showtime.presentation && showtime.presentation !== "STANDARD" ? ` · ${presentationLabel(showtime.presentation)}` : ""}</small>
                  </button>
                  {!isPast && <button type="button" className="showtime-quick-remove" aria-label={`Remove ${showtime.movie.title} from schedule`} title="Remove from schedule" onClick={(event) => { event.stopPropagation(); void onRemoveShowtime(showtime); }}>×</button>}
                  {!isPast && <button type="button" className="showtime-quick-duplicate" aria-label={`Schedule ${showtime.movie.title} again afterward`} title="Schedule this film again afterward" onClick={(event) => { event.stopPropagation(); void duplicateAfter(showtime); }}>+</button>}
                </div>;
              })}
            </div>
          </div>;
        })}

        {!auditoriums.length && <div className="calendar-empty">Create an auditorium before scheduling showtimes.</div>}
      </div>
    </div>}

    {view === "week" && <div className="week-scroll">
      <div className="week-calendar">
        {weekDays.map((date) => {
          const end = new Date(date.getTime() + TOTAL_HOURS * 60 * 60000);
          const dayShowtimes = showtimes.filter((showtime) => {
            const starts = new Date(showtime.startsAt);
            return starts >= date && starts < end;
          });
          return <section className="week-day" key={date.toISOString()}>
            <header><strong>{date.toLocaleDateString([], { weekday: "short" })}</strong><span>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></header>
            {auditoriums.map((auditorium) => {
              const roomShowtimes = dayShowtimes.filter((showtime) => showtime.auditorium.id === auditorium.id);
              return <div
                className={`week-room ${draggingKey?.startsWith("showtime:") ? "drag-target" : ""}`}
                key={auditorium.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void dropOnWeekRoom(event, auditorium.id, date)}
              >
                <b>{auditorium.name}</b>
                {roomShowtimes.length ? roomShowtimes.map((showtime) => {
                  const isPast = new Date(showtime.startsAt) < now;
                  return <button
                    type="button"
                    draggable={!isPast}
                    className={`week-showtime ${isPast ? "past" : showtime.onSale ? "on-sale" : "draft"}`}
                    key={showtime.id}
                    onClick={() => onEdit(showtime)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      const key = `showtime:${showtime.id}`;
                      event.dataTransfer.setData("text/plain", key);
                      setDraggingKey(key);
                    }}
                    onDragEnd={() => { setDraggingKey(null); setDropPreview(null); }}
                  ><time>{formatTime(showtime.startsAt)}</time><span>{showtime.movie.title}{showtime.filmSeries ? ` · ${showtime.filmSeries.name}` : ""}</span></button>;
                }) : <small>Open</small>}
              </div>;
            })}
          </section>;
        })}
      </div>
    </div>}

    <div className="film-library" aria-label={labels.filmLibrary}>
      <div className="film-library-overview">
      <div className="film-library-heading"><div><b>{labels.filmLibrary}</b><button type="button" className="film-library-add" onClick={onAddMovie}>{labels.addMovie}</button></div><span>{labels.filmLibraryHelp}</span></div>
      <section className="film-library-detail" aria-live="polite">
        {selectedLibraryMovie ? <>
          <div className="film-detail-poster">
            {selectedLibraryMovie.posterUrl
              ? <img src={selectedLibraryMovie.posterUrl} alt={`${selectedLibraryMovie.title} poster`} />
              : <span>Poster not added</span>}
          </div>
          <div className="film-detail-copy">
            <div className="film-detail-heading">
              <div>
                <p className="kicker">SELECTED FILM</p>
                <h3>{selectedLibraryMovie.title}</h3>
              </div>
              <button type="button" className="film-detail-edit" onClick={() => onEditMovie(selectedLibraryMovie)}>Edit film details</button>
            </div>
            <p className="film-detail-meta">{selectedLibraryMovie.rating || "Not rated"} · {selectedLibraryMovie.runtimeMinutes} min</p>
            <p className="film-detail-synopsis">{selectedLibraryMovie.synopsis || "No synopsis has been added yet."}</p>

            <div className="film-programming-summary">
              <div>
                <span>Film series / special event</span>
                <div className="film-badges">{filmSeries.length
                  ? filmSeries.map((series) => <b key={series.id} title={series.description ?? undefined}>{series.name}</b>)
                  : <em>Not assigned on any scheduled appearance</em>}</div>
              </div>
              <div>
                <span>Presentations</span>
                <div className="film-badges">{presentations.length
                  ? presentations.map((presentation) => <b key={presentation}>{presentationLabel(presentation)}</b>)
                  : <em>No scheduled appearances</em>}</div>
              </div>
            </div>

            <div className="film-appearances">
              <h4>Upcoming appearances</h4>
              {upcomingMovieShowtimes.length ? <ul>{upcomingMovieShowtimes.map((showtime) => <li key={showtime.id}>
                <button type="button" onClick={() => onEdit(showtime)}>
                  <span>{new Date(showtime.startsAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {formatTime(showtime.startsAt)}</span>
                  <strong>{showtime.auditorium.name}</strong>
                  <small>{showtime.filmSeries?.name || "Regular engagement"}{showtime.presentation && showtime.presentation !== "STANDARD" ? ` · ${presentationLabel(showtime.presentation)}` : ""}</small>
                </button>
              </li>)}</ul> : <p>No upcoming appearances are scheduled.</p>}
            </div>
          </div>
        </> : <div className="film-detail-empty">
          <p className="kicker">FILM DETAILS</p>
          <h3>Select a film</h3>
          <p>Its poster, synopsis, event or series labels, presentation types, and upcoming appearances will appear here.</p>
        </div>}
      </section>

      <details className="archived-films" open={normalizedFilmQuery ? true : undefined}>
        <summary>Archived films <span>{normalizedFilmQuery ? filteredArchivedMovies.length : archivedMovies.length}</span></summary>
        <p>Archived films stay connected to their historical showtimes, ticket sales, and reports.</p>
        {filteredArchivedMovies.length ? <div className="archived-film-list">{filteredArchivedMovies.map((movie) => <div key={movie.id}>
          <span><strong>{movie.title}</strong><small>{movie.runtimeMinutes} min</small></span>
          <div><button type="button" onClick={() => void onRestoreMovie(movie)}>Restore</button><button type="button" className="danger" onClick={() => void onDeleteMovie(movie)}>Delete permanently</button></div>
        </div>)}</div> : <p>{normalizedFilmQuery ? "No archived films match this search." : "No archived films."}</p>}
      </details>
      </div>
      <div className="film-library-content">
        <label className="film-library-search"><span className="sr-only">Search active and archived films</span><input type="search" value={filmQuery} onChange={(event) => setFilmQuery(event.target.value)} placeholder={labels.search} /></label>
      <div className="film-library-list">
        {filteredMovies.map((movie) => <div
          className={`film-card ${selectedMovieId === movie.id ? "selected" : ""}`}
          draggable
          key={movie.id}
          role="button"
          tabIndex={0}
          aria-pressed={selectedMovieId === movie.id}
          onClick={() => setSelectedMovieId(movie.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedMovieId(movie.id);
            }
          }}
          onDragStart={(event) => {
            const key = `movie:${movie.id}`;
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", key);
            setDraggingKey(key);
          }}
          onDragEnd={() => { setDraggingKey(null); setDropPreview(null); }}
          title="Drag this film onto the daily schedule"
        ><button type="button" className="film-edit" onClick={(event) => { event.stopPropagation(); onEditMovie(movie); }} onMouseDown={(event) => event.stopPropagation()} aria-label={`Edit ${movie.title}`}>Edit</button><strong>{movie.title}</strong><span>{movie.runtimeMinutes} min</span><button type="button" className="film-quick-add" onClick={(event) => { event.stopPropagation(); void quickAddToSchedule(movie); }} onMouseDown={(event) => event.stopPropagation()}>Add +</button><button
          type="button"
          className="film-archive"
          aria-label={`Remove ${movie.title} from the film library`}
          title="Remove from film library"
          onClick={(event) => { event.stopPropagation(); void onArchiveMovie(movie); }}
          onMouseDown={(event) => event.stopPropagation()}
        >×</button></div>)}
        {normalizedFilmQuery && filteredArchivedMovies.map((movie) => <div className="archived-search-result" key={`archived-${movie.id}`}>
          <span><small>Archived</small><strong>{movie.title}</strong></span><span>{movie.runtimeMinutes} min</span><button type="button" onClick={() => void onRestoreMovie(movie)}>Restore</button><button type="button" className="danger" onClick={() => void onDeleteMovie(movie)}>Delete permanently</button>
        </div>)}
        {!filteredMovies.length && <div className="film-library-empty"><strong>No active films found</strong><span>{filteredArchivedMovies.length ? "Matching archived films are shown below." : "Try a different title."}</span><button type="button" onClick={() => setFilmQuery("")}>Clear search</button></div>}
      </div>
      </div>
    </div>

    {duplicateOpen && <div className="editor-backdrop duplicate-day-backdrop" role="presentation" onMouseDown={() => setDuplicateOpen(false)}>
      <form className="showtime-drawer duplicate-day-drawer" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => {
        event.preventDefault();
        const targets = duplicateTarget && !duplicateTargets.includes(duplicateTarget) ? [...duplicateTargets, duplicateTarget] : duplicateTargets;
        if (!targets.length) {
          setDuplicateError("Choose at least one target day.");
          return;
        }
        if (targets.includes(selectedDate)) {
          setDuplicateError("Choose a target day different from the source day.");
          return;
        }
        setDuplicateError(null);
        setDuplicating(true);
        try {
          await onDuplicateDay(selectedDate, targets, duplicateSaleStatus);
          setDuplicateOpen(false);
        } catch (reason) {
          setDuplicateError(reason instanceof Error && reason.message
            ? reason.message
            : "The schedule could not be duplicated. Please try again.");
        } finally { setDuplicating(false); }
      }}>
        <div className="drawer-heading"><div><p className="kicker">SCHEDULING</p><h2>Duplicate day</h2></div><button type="button" className="drawer-close" onClick={() => setDuplicateOpen(false)}>×</button></div>
        <p>Copy every showing from <strong>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</strong>. Conflicts stop the copy before anything is changed.</p>
        <label>Target day<div className="duplicate-target-input"><input type="date" min={selectedDate} value={duplicateTarget} onChange={(event) => { setDuplicateTarget(event.target.value); setDuplicateError(null); }} /><button type="button" onClick={() => {
          if (duplicateTarget === selectedDate) {
            setDuplicateError("Choose a target day different from the source day.");
            return;
          }
          if (duplicateTarget) {
            setDuplicateTargets((current) => current.includes(duplicateTarget) ? current : [...current, duplicateTarget].sort());
            setDuplicateError(null);
          }
        }}>Add</button></div></label>
        <div className="duplicate-targets">{duplicateTargets.map((date) => <button type="button" key={date} onClick={() => setDuplicateTargets((current) => current.filter((item) => item !== date))}>{new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ×</button>)}</div>
        <label>Sale status<select value={duplicateSaleStatus} onChange={(event) => setDuplicateSaleStatus(event.target.value as typeof duplicateSaleStatus)}><option value="PRESERVE">Preserve each showing</option><option value="ON_SALE">Open all for sale</option><option value="DRAFT">Copy all as drafts</option></select></label>
        {duplicateError && <div className="error-banner duplicate-day-error" role="alert">{duplicateError}</div>}
        <button className="primary" disabled={duplicating}>{duplicating ? "Copying…" : "Duplicate schedule"}</button>
        <button type="button" className="secondary" onClick={() => setDuplicateOpen(false)}>Cancel</button>
      </form>
    </div>}
  </section>;
}
