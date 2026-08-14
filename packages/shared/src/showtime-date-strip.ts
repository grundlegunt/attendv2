function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Keeps the compact showtime-date strip anchored to today until a customer
 * chooses a date outside it. Calendar selections then become the first of the
 * three visible dates, so the active date never disappears from the header.
 */
export function showtimeDateStrip(today: string, selectedDate: string | null, length = 3) {
  const todayDate = parseDateKey(today);
  const initialDates = Array.from({ length }, (_, offset) => {
    const date = new Date(todayDate);
    date.setDate(todayDate.getDate() + offset);
    return formatDateKey(date);
  });
  const anchor = selectedDate && !initialDates.includes(selectedDate) ? selectedDate : today;
  const anchorDate = parseDateKey(anchor);

  return Array.from({ length }, (_, offset) => {
    const date = new Date(anchorDate);
    date.setDate(anchorDate.getDate() + offset);
    return formatDateKey(date);
  });
}
