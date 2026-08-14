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

export function applyShowtimeMoves<
  Auditorium extends { id: string },
  Showtime extends {
    id: string;
    startsAt: string;
    featureStartsAt: string;
    endsAt: string;
    roomReadyAt: string;
    auditorium: Auditorium;
  },
>(showtimes: Showtime[], auditoriums: Auditorium[], moves: ShowtimeMoveSnapshot[]): Showtime[] {
  const movesById = new Map(moves.map((move) => [move.showtimeId, move]));
  const auditoriumsById = new Map(auditoriums.map((auditorium) => [auditorium.id, auditorium]));
  return showtimes.map((showtime) => {
    const move = movesById.get(showtime.id);
    const auditorium = move ? auditoriumsById.get(move.auditoriumId) : undefined;
    if (!move || !auditorium) return showtime;
    const offset = new Date(move.startsAt).getTime() - new Date(showtime.startsAt).getTime();
    const shift = (value: string) => new Date(new Date(value).getTime() + offset).toISOString();
    return {
      ...showtime,
      auditorium,
      startsAt: move.startsAt,
      featureStartsAt: shift(showtime.featureStartsAt),
      endsAt: shift(showtime.endsAt),
      roomReadyAt: shift(showtime.roomReadyAt),
    };
  });
}
