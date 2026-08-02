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
}

interface SchedulingCalendarProps {
  auditoriums: ScheduleAuditorium[];
  showtimes: CalendarShowtime[];
  preShowBufferMinutes: number;
  cleaningBufferMinutes: number;
  onCreate: (auditoriumId: string, startsAt: Date) => void;
  onEdit: (showtime: CalendarShowtime) => void;
}

const START_HOUR = 10;
const TOTAL_HOURS = 18;
const HOUR_WIDTH = 112;

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
  showtimes,
  preShowBufferMinutes,
  cleaningBufferMinutes,
  onCreate,
  onEdit,
}: SchedulingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(() => dateInputValue(new Date()));
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

  return <section className="schedule-workspace" aria-label="Showtime scheduling calendar">
    <div className="schedule-toolbar">
      <div>
        <p className="kicker">PROGRAMMING</p>
        <h2>Daily theater schedule</h2>
        <p>Click an open time to add a showing. Click a film to edit it.</p>
      </div>
      <div className="date-controls">
        <button type="button" className="calendar-nav" onClick={() => changeDay(-1)} aria-label="Previous day">←</button>
        <button type="button" className="calendar-today" onClick={() => setSelectedDate(dateInputValue(new Date()))}>Today</button>
        <input aria-label="Schedule date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        <button type="button" className="calendar-nav" onClick={() => changeDay(1)} aria-label="Next day">→</button>
      </div>
    </div>

    <div className="schedule-legend" aria-label="Schedule legend">
      <span><i className="legend-swatch on-sale" /> On sale</span>
      <span><i className="legend-swatch draft" /> Draft</span>
      <span><i className="legend-swatch past" /> Past</span>
      <span>{preShowBufferMinutes}m pre-show + runtime + {cleaningBufferMinutes}m cleaning</span>
    </div>

    <div className="calendar-scroll">
      <div className="cinema-calendar" style={{ "--timeline-width": `${TOTAL_HOURS * HOUR_WIDTH}px` } as React.CSSProperties}>
        <div className="calendar-corner"><span>ROOM</span></div>
        <div className="time-ruler">
          {hours.map((hour) => <span key={hour.index} style={{ left: `${hour.index * HOUR_WIDTH}px` }}>{hour.label}</span>)}
        </div>

        {auditoriums.map((auditorium) => {
          const roomShowtimes = visibleShowtimes.filter((showtime) => showtime.auditorium.id === auditorium.id);
          return <div className="calendar-row" key={auditorium.id}>
            <div className="room-label"><strong>{auditorium.name}</strong><span>{auditorium.capacity} seats</span></div>
            <div className="room-timeline" onClick={(event) => createAtPointer(event, auditorium.id)}>
              {hours.slice(0, -1).map((hour) => <i key={hour.index} style={{ left: `${hour.index * HOUR_WIDTH}px` }} />)}
              {roomShowtimes.map((showtime) => {
                const startMinutes = Math.max(0, minutesFrom(dayStart, showtime.startsAt));
                const endMinutes = Math.min(TOTAL_HOURS * 60, minutesFrom(dayStart, showtime.roomReadyAt));
                const left = (startMinutes / 60) * HOUR_WIDTH;
                const width = Math.max(82, ((endMinutes - startMinutes) / 60) * HOUR_WIDTH - 8);
                const isPast = new Date(showtime.startsAt) < now;
                const status = isPast ? "past" : showtime.onSale ? "on-sale" : "draft";
                return <button
                  type="button"
                  className={`showtime-block ${status}`}
                  key={showtime.id}
                  style={{ left: `${left + 4}px`, width: `${width}px` }}
                  onClick={(event) => { event.stopPropagation(); onEdit(showtime); }}
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
    </div>
  </section>;
}
