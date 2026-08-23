"use client";

import { useEffect, useMemo, useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function dateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: Date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function ShowtimeCalendar({
  availableDates,
  selectedDate,
  today,
  onClose,
  onSelect,
}: {
  availableDates: string[];
  selectedDate: string | null;
  today: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  const initialDate = parseDateKey(selectedDate ?? availableDates.find((date) => date >= today) ?? today);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(Date.UTC(initialDate.getUTCFullYear(), initialDate.getUTCMonth(), 1)));
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const firstAvailable = parseDateKey(availableDates[0] ?? today);
  const lastAvailable = parseDateKey(availableDates.at(-1) ?? today);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const cells = useMemo(() => {
    const year = visibleMonth.getUTCFullYear();
    const month = visibleMonth.getUTCMonth();
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstWeekday + 1;
      return day >= 1 && day <= days ? new Date(Date.UTC(year, month, day)) : null;
    });
  }, [visibleMonth]);

  const canGoPrevious = monthKey(visibleMonth) > monthKey(firstAvailable);
  const canGoNext = monthKey(visibleMonth) < monthKey(lastAvailable);
  const monthLabel = visibleMonth.toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="showtime-calendar" role="dialog" aria-modal="true" aria-labelledby="showtime-calendar-title">
      <button className="showtime-calendar__backdrop" type="button" aria-label="Close calendar" onClick={onClose} />
      <section className="showtime-calendar__dialog">
        <header className="showtime-calendar__header">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canGoPrevious}
            onClick={() => setVisibleMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}
          >
            ‹
          </button>
          <h2 id="showtime-calendar-title">{monthLabel}</h2>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canGoNext}
            onClick={() => setVisibleMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}
          >
            ›
          </button>
          <button className="showtime-calendar__close" type="button" aria-label="Close calendar" onClick={onClose}>×</button>
        </header>

        <div className="showtime-calendar__weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="showtime-calendar__grid">
          {cells.map((date, index) => {
            if (!date) return <span key={`empty-${index}`} className="showtime-calendar__empty" />;
            const key = dateKey(date);
            const available = availableSet.has(key);
            const isToday = key === today;
            const isSelected = key === selectedDate;
            return (
              <button
                key={key}
                type="button"
                disabled={!available}
                className={`${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`.trim()}
                aria-label={`${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}${isToday ? ", today" : ""}`}
                aria-pressed={isSelected}
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
              >
                <strong>{date.getUTCDate()}</strong>
                {isToday && <small>Today</small>}
              </button>
            );
          })}
        </div>
        <p className="showtime-calendar__help">Choose a highlighted date to see scheduled showtimes.</p>
      </section>
    </div>
  );
}
