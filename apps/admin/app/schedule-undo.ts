export interface ShowtimeMoveSnapshot {
  showtimeId: string;
  auditoriumId: string;
  startsAt: string;
}

export function captureShowtimeMoves(
  showtimes: Array<{ id: string; startsAt: string; auditorium: { id: string } }>,
): ShowtimeMoveSnapshot[] {
  return showtimes.map((showtime) => ({
    showtimeId: showtime.id,
    auditoriumId: showtime.auditorium.id,
    startsAt: showtime.startsAt,
  }));
}
