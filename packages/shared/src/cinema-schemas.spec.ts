import {
  dedupePublicShowtimes,
  startOfLocalDay,
  showtimeWindowsOverlap,
  type PublicShowtime,
  validateSeatLayout,
} from "./cinema-schemas";

describe("startOfLocalDay", () => {
  it("keeps the full current cinema day visible after showtimes begin", () => {
    expect(startOfLocalDay(new Date("2026-08-01T22:15:00.000Z"), "America/Chicago").toISOString())
      .toBe("2026-08-01T05:00:00.000Z");
  });

  it("resolves midnight correctly during standard time", () => {
    expect(startOfLocalDay(new Date("2026-01-15T18:00:00.000Z"), "America/Chicago").toISOString())
      .toBe("2026-01-15T06:00:00.000Z");
  });
});

describe("validateSeatLayout", () => {
  const base = [
    { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD" as const },
    { label: "A2", rowLabel: "A", number: 2, x: 1, y: 0, type: "STANDARD" as const },
  ];

  it("accepts unique seats", () => expect(validateSeatLayout(base)).toEqual([]));
  it("rejects duplicate labels", () =>
    expect(validateSeatLayout([...base, { ...base[1]!, label: "a1", x: 2 }])).toContain(
      "Duplicate seat label: a1.",
    ));
  it("rejects duplicate coordinates", () =>
    expect(validateSeatLayout([...base, { ...base[1]!, label: "A3", number: 3, x: 0 }])).toContain(
      "Duplicate seat coordinate: 0:0.",
    ));
  it("requires complete left/right table pairs", () =>
    expect(
      validateSeatLayout([
        ...base,
        { ...base[0]!, label: "B1", x: 0, y: 1, tableGroupId: "B-1", tablePosition: "LEFT" },
      ]),
    ).toContain("Table group B-1 must contain exactly one LEFT and one RIGHT seat."));
});

describe("showtimeWindowsOverlap", () => {
  const start = new Date("2026-07-25T18:00:00Z");
  const ready = new Date("2026-07-25T21:00:00Z");
  it("rejects an overlapping window", () =>
    expect(
      showtimeWindowsOverlap(
        { startsAt: start, roomReadyAt: ready },
        { startsAt: new Date("2026-07-25T20:59:00Z"), roomReadyAt: new Date("2026-07-25T23:00:00Z") },
      ),
    ).toBe(true));
  it("accepts a window starting exactly when the room is ready", () =>
    expect(
      showtimeWindowsOverlap(
        { startsAt: start, roomReadyAt: ready },
        { startsAt: ready, roomReadyAt: new Date("2026-07-25T23:00:00Z") },
      ),
    ).toBe(false));
});

function screening(id: string, startsAt: string, auditoriumId = "room-1"): PublicShowtime {
  return {
    id,
    startsAt,
    auditorium: { id: auditoriumId, name: "Theater 1", capacity: 60 },
    priceTier: { name: "Standard", ticketPriceMinor: 1700, feeMinor: 200, currency: "USD" },
  };
}

describe("dedupePublicShowtimes", () => {
  it("keeps one choice for the same auditorium and advertised start", () => {
    const first = screening("showtime-1", "2026-08-01T22:15:00.000Z");
    const duplicate = screening("showtime-2", "2026-08-01T22:15:00.000Z");

    expect(dedupePublicShowtimes([first, duplicate])).toEqual([first]);
  });

  it("keeps screenings on different dates or in different auditoriums", () => {
    const showtimes = [
      screening("showtime-1", "2026-08-01T22:15:00.000Z"),
      screening("showtime-2", "2026-08-02T22:15:00.000Z"),
      screening("showtime-3", "2026-08-01T22:15:00.000Z", "room-2"),
    ];

    expect(dedupePublicShowtimes(showtimes)).toEqual(showtimes);
  });
});
