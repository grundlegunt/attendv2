"use client";

import { useMemo, useState } from "react";

export interface ScheduleAuditorium {
  id: string;
  name: string;
  capacity: number;
}

export interface ScheduleMovie {
  id: string;
  title: string;
  runtimeMinutes: number;
}

export interface CalendarShowtime {
  id: string;
  startsAt: string;
  featureStartsAt: string;
  endsAt: string;
  roomReadyAt: string;
  onSale: boolean;
  movie: ScheduleMovie;
  auditorium: ScheduleAuditorium;
  priceTier: { id: string; name: string; ticketPriceMinor: number; feeMinor: number; currency: string };
}

interface SchedulingCalendarProps {
  auditoriums: ScheduleAuditorium[];
  movies: ScheduleMovie[];
  showtimes: CalendarShowtime[];
  preShowBufferMinutes: number;
  cleaningBufferMinutes: number;
  onCreate: (auditoriumId: string, startsAt: Date, movieId?: string) => void;
  onEdit: (showtime: CalendarShowtime) => void;
  onMove: (showtime: CalendarShowtime, auditoriumId: string, startsAt: Date) => Promise<void>;
  onAddMovie: () => void;
  onArchiveMovie: (movie: ScheduleMovie) => Promise<void>;
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
  auditoriums,
  movies,
  showtimes,
  preShowBufferMinutes,
  cleaningBufferMinutes,
  onCreate,
  onEdit,
  onMove,
  onAddMovie,
  onArchiveMovie,
}: SchedulingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<{ auditoriumId: string; startsAt: Date } | null>(null);
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

  function createAtPointer(event: React.MouseEvent<HTMLDivElement>, auditoriumId: string) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawMinutes = ((event.clientX - bounds.left) / bounds.width) * TOTAL_HOURS * 60;
    const roundedMinutes = Math.max(0, Math.min(TOTAL_HOURS * 60 - 5, Math.round(rawMinutes / 5) * 5));
    onCreate(auditoriumId, new Date(dayStart.getTime() + roundedMinutes * 60000));
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
      onCreate(auditoriumId, targetTime, key.slice("movie:".length));
      return;
    }
    const showtimeId = key?.startsWith("showtime:") ? key.slice("showtime:".length) : key;
    const showtime = showtimes.find((item) => item.id === showtimeId);
    if (!showtime) return;
    await onMove(showtime, auditoriumId, targetTime);
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

  return <section className="schedule-workspace" aria-label="Showtime scheduling calendar">
    <div className="schedule-toolbar">
      <div>
        <p className="kicker">PROGRAMMING</p>
        <h2>Daily theater schedule</h2>
        <p>Click an open time to add a showing. Click a film to edit it.</p>
      </div>
      <div className="schedule-actions">
        <div className="view-switch" aria-label="Schedule view">
          <button type="button" className={view === "day" ? "active" : ""} onClick={() => setView("day")}>Day</button>
          <button type="button" className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Week</button>
        </div>
        <button type="button" className="add-film-button" onClick={onAddMovie}>+ Add film</button>
      </div>
      <div className="date-controls">
        <button type="button" className="calendar-nav" onClick={() => changeDay(view === "week" ? -7 : -1)} aria-label={`Previous ${view}`}>←</button>
        <button type="button" className="calendar-today" onClick={() => setSelectedDate(dateInputValue(new Date()))}>Today</button>
        <input aria-label="Schedule date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        <button type="button" className="calendar-nav" onClick={() => changeDay(view === "week" ? 7 : 1)} aria-label={`Next ${view}`}>→</button>
      </div>
    </div>

    <div className="schedule-legend" aria-label="Schedule legend">
      <span><i className="legend-swatch on-sale" /> On sale</span>
      <span><i className="legend-swatch draft" /> Draft</span>
      <span><i className="legend-swatch past" /> Past</span>
      <span>{preShowBufferMinutes}m pre-show + runtime + {cleaningBufferMinutes}m cleaning</span>
    </div>

    {view === "day" && <div className="calendar-scroll">
      <div className="cinema-calendar" style={{ "--timeline-width": `${TOTAL_HOURS * HOUR_WIDTH}px` } as React.CSSProperties}>
        <div className="calendar-corner"><span>ROOM</span></div>
        <div className="time-ruler">
          {hours.map((hour) => <span key={hour.index} style={{ left: `${hour.index * HOUR_WIDTH}px` }}>{hour.label}</span>)}
        </div>

        {auditoriums.map((auditorium) => {
          const roomShowtimes = visibleShowtimes.filter((showtime) => showtime.auditorium.id === auditorium.id);
          return <div className="calendar-row" key={auditorium.id}>
            <div className="room-label"><strong>{auditorium.name}</strong><span>{auditorium.capacity} seats</span></div>
            <div
              className={`room-timeline ${draggingKey ? "drag-target" : ""}`}
              onClick={(event) => createAtPointer(event, auditorium.id)}
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
              {draggingKey && dropPreview?.auditoriumId === auditorium.id && (() => {
                const movie = draggingKey.startsWith("movie:")
                  ? movies.find((item) => item.id === draggingKey.slice("movie:".length))
                  : showtimes.find((item) => item.id === draggingKey.slice("showtime:".length))?.movie;
                const durationMinutes = preShowBufferMinutes + (movie?.runtimeMinutes ?? 90) + cleaningBufferMinutes;
                const left = (minutesFrom(dayStart, dropPreview.startsAt) / 60) * HOUR_WIDTH;
                const width = Math.max(82, (durationMinutes / 60) * HOUR_WIDTH - 8);
                return <div className="drop-preview" style={{ left: `${left + 4}px`, width: `${width}px` }}>
                  <strong>{movie?.title ?? "Showing"}</strong>
                  <span>{formatTime(dropPreview.startsAt)}</span>
                </div>;
              })()}
              {roomShowtimes.map((showtime) => {
                const startMinutes = Math.max(0, minutesFrom(dayStart, showtime.startsAt));
                const endMinutes = Math.min(TOTAL_HOURS * 60, minutesFrom(dayStart, showtime.roomReadyAt));
                const left = (startMinutes / 60) * HOUR_WIDTH;
                const width = Math.max(82, ((endMinutes - startMinutes) / 60) * HOUR_WIDTH - 8);
                const isPast = new Date(showtime.startsAt) < now;
                const status = isPast ? "past" : showtime.onSale ? "on-sale" : "draft";
                return <button
                  type="button"
                  draggable={!isPast}
                  className={`showtime-block ${status}`}
                  key={showtime.id}
                  style={{ left: `${left + 4}px`, width: `${width}px` }}
                  onClick={(event) => { event.stopPropagation(); onEdit(showtime); }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    const key = `showtime:${showtime.id}`;
                    event.dataTransfer.setData("text/plain", key);
                    setDraggingKey(key);
                  }}
                  onDragEnd={() => { setDraggingKey(null); setDropPreview(null); }}
                  title={`Edit ${showtime.movie.title}`}
                >
                  <strong>{showtime.movie.title}</strong>
                  <span>{formatTime(showtime.startsAt)} · Feature {formatTime(showtime.featureStartsAt)}</span>
                  <small>Ready {formatTime(showtime.roomReadyAt)} · {showtime.onSale ? "On sale" : "Draft"}</small>
                </button>;
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
                  ><time>{formatTime(showtime.startsAt)}</time><span>{showtime.movie.title}</span></button>;
                }) : <small>Open</small>}
              </div>;
            })}
          </section>;
        })}
      </div>
    </div>}

    <div className="film-library" aria-label="Film library">
      <div><b>Film library</b><span>Drag a film into an open room time</span></div>
      <div className="film-library-list">
        {movies.map((movie) => <div
          className="film-card"
          draggable
          key={movie.id}
          onDragStart={(event) => {
            const key = `movie:${movie.id}`;
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("text/plain", key);
            setDraggingKey(key);
          }}
          onDragEnd={() => { setDraggingKey(null); setDropPreview(null); }}
          title="Drag this film onto the daily schedule"
        ><strong>{movie.title}</strong><span>{movie.runtimeMinutes} min</span><button
          type="button"
          className="film-archive"
          aria-label={`Remove ${movie.title} from the film library`}
          title="Remove from film library"
          onClick={(event) => { event.stopPropagation(); void onArchiveMovie(movie); }}
          onMouseDown={(event) => event.stopPropagation()}
        >×</button></div>)}
      </div>
    </div>
  </section>;
}
