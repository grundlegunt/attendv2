import { startOfCalendarDay } from "@cinema/shared";

export function localDateInputValue(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextDateKey(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid report date range.");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Choose a valid report date range.");
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function inclusiveReportRange(from: string, through: string, timeZone: string): {
  from: string;
  to: string;
} {
  let start: Date;
  let endExclusive: Date;
  try {
    start = startOfCalendarDay(from, timeZone);
    endExclusive = startOfCalendarDay(nextDateKey(through), timeZone);
  } catch {
    throw new Error("Choose a valid report date range.");
  }
  if (start >= endExclusive) throw new Error("The report start date must be on or before the end date.");
  return { from: start.toISOString(), to: endExclusive.toISOString() };
}

export function inclusiveDateCutoff(value: string, timeZone: string): string {
  const { to } = inclusiveReportRange(value, value, timeZone);
  return new Date(new Date(to).getTime() - 1).toISOString();
}
