import {
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  dedupePublicShowtimes,
  startOfLocalDay,
  showtimeWindowsOverlap,
  updateShowtimeRequestSchema,
  type PublicShowtime,
  type SeatMapLayout,
  validateAdvancedSeatLayout,
  validateSeatLayout,
} from "./cinema-schemas";

describe("cinema programming requests", () => {
  const showtime = {
    movieId: "10000000-0000-4000-8000-000000000001",
    auditoriumId: "10000000-0000-4000-8000-000000000002",
    priceTierId: "10000000-0000-4000-8000-000000000003",
    startsAt: "2026-08-04T18:00:00.000Z",
  };

  it("accepts movie metadata with either an absolute or app-relative poster URL", () => {
    expect(createMovieRequestSchema.parse({
      title: "The Matrix",
      runtimeMinutes: 136,
      synopsis: "A programmer discovers the world is not what it seems.",
      rating: "R",
      posterUrl: "https://images.example.com/matrix.jpg",
    }).posterUrl).toContain("images.example.com");

    expect(createMovieRequestSchema.parse({
      title: "The Matrix",
      runtimeMinutes: 136,
      posterUrl: "/posters/matrix.jpg",
    }).posterUrl).toBe("/posters/matrix.jpg");
  });

  it("stores film-series and presentation labels on a new showtime", () => {
    const parsed = createShowtimeRequestSchema.parse({
      ...showtime,
      filmSeries: "Summer Classics",
      presentation: "Q_AND_A",
    });

    expect(parsed.filmSeries).toBe("Summer Classics");
    expect(parsed.presentation).toBe("Q_AND_A");
  });

  it("does not reset sale or presentation values on an unrelated partial update", () => {
    expect(updateShowtimeRequestSchema.parse({ startsAt: showtime.startsAt })).toEqual({
      startsAt: showtime.startsAt,
    });
  });
});

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

describe("validateAdvancedSeatLayout", () => {
  const layout: SeatMapLayout = {
    mode: "ADVANCED",
    canvas: { width: 12, height: 8 },
    screenPosition: "TOP",
    seatingStyle: "SINGLE",
    levels: [
      { id: "main", name: "Main floor", sortOrder: 0 },
      { id: "balcony", name: "Balcony", sortOrder: 1 },
    ],
    sections: [],
    elements: [],
  };

  it("allows the same grid coordinate on separate levels", () => {
    expect(validateAdvancedSeatLayout([
      { label: "A1", rowLabel: "A", number: 1, x: 0, y: 0, type: "STANDARD", levelKey: "main" },
      { label: "BA1", rowLabel: "BA", number: 1, x: 0, y: 0, type: "STANDARD", levelKey: "balcony" },
    ], layout)).toEqual([]);
  });

  it("rejects seats and non-seat elements outside the canvas", () => {
    const errors = validateAdvancedSeatLayout([
      { label: "A1", rowLabel: "A", number: 1, x: 12, y: 0, type: "STANDARD", levelKey: "main" },
    ], { ...layout, elements: [{ id: "wall", type: "WALL", levelId: "main", x: 10, y: 0, width: 3, height: 1 }] });
    expect(errors).toContain("Seat A1 is outside the canvas.");
    expect(errors).toContain("Layout element wall is outside the canvas.");
  });
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
