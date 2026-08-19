const pad = (value: number) => String(value).padStart(2, "0");

export function localDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid report date range.");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    throw new Error("Choose a valid report date range.");
  }
  return date;
}

export function inclusiveReportRange(from: string, through: string): {
  from: string;
  to: string;
} {
  const start = parseLocalDate(from);
  const endExclusive = parseLocalDate(through);
  endExclusive.setDate(endExclusive.getDate() + 1);
  if (start >= endExclusive) throw new Error("The report start date must be on or before the end date.");
  return { from: start.toISOString(), to: endExclusive.toISOString() };
}

export function inclusiveDateCutoff(value: string): string {
  const { to } = inclusiveReportRange(value, value);
  return new Date(new Date(to).getTime() - 1).toISOString();
}
