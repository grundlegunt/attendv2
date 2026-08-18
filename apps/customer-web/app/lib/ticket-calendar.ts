export interface CalendarTicket {
  id: string;
  movie: string;
  auditorium: string;
  seat: string;
  startsAt: string;
  endsAt: string;
}

function escapeCalendarText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function calendarDate(value: string) {
  return new Date(value).toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

export function ticketCalendar(orderNumber: string, tickets: CalendarTicket[]) {
  const showtimes = new Map<string, CalendarTicket[]>();
  for (const ticket of tickets) {
    const key = `${ticket.movie}\u0000${ticket.auditorium}\u0000${ticket.startsAt}\u0000${ticket.endsAt}`;
    showtimes.set(key, [...(showtimes.get(key) ?? []), ticket]);
  }

  const events = [...showtimes.values()].map((showtimeTickets) => {
    const first = showtimeTickets[0]!;
    const seats = showtimeTickets.map((ticket) => ticket.seat).join(", ");
    return [
      "BEGIN:VEVENT",
      `UID:${escapeCalendarText(`${orderNumber}-${first.id}@attend`)}`,
      `DTSTART:${calendarDate(first.startsAt)}`,
      `DTEND:${calendarDate(first.endsAt)}`,
      `SUMMARY:${escapeCalendarText(first.movie)}`,
      `LOCATION:${escapeCalendarText(first.auditorium)}`,
      `DESCRIPTION:${escapeCalendarText(`Order ${orderNumber} · Seat${showtimeTickets.length === 1 ? "" : "s"} ${seats}`)}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Attend//Cinema Tickets//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR", ""].join("\r\n");
}

export function downloadTicketCalendar(orderNumber: string, tickets: CalendarTicket[]) {
  const blob = new Blob([ticketCalendar(orderNumber, tickets)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tickets-${orderNumber.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
