import {
  adminUiConfigSchema,
  adminUiDefaults,
  createFilmSeriesRequestSchema,
  customerBrandingSchema,
  createMovieRequestSchema,
  createShowtimeRequestSchema,
  dedupePublicShowtimes,
  duplicateShowtimeDayRequestSchema,
  moveShowtimeGroupRequestSchema,
  startOfLocalDay,
  showtimeWindowsOverlap,
  updateShowtimeRequestSchema,
  updateFilmSeriesRequestSchema,
  type PublicShowtime,
  type SeatMapLayout,
  validateAdvancedSeatLayout,
  validateSeatLayout,
} from "./cinema-schemas";

describe("admin schedule appearance", () => {
  it("adds default showtime control colors to previously saved configurations", () => {
    const legacyConfig = {
      ...adminUiDefaults,
      colorHistory: [],
    } as Record<string, unknown>;
    delete legacyConfig.removeControlColor;
    delete legacyConfig.duplicateControlColor;

    const parsed = adminUiConfigSchema.parse(legacyConfig);

    expect(parsed.removeControlColor).toBe(adminUiDefaults.removeControlColor);
    expect(parsed.duplicateControlColor).toBe(adminUiDefaults.duplicateControlColor);
  });
});

describe("customer branding settings", () => {
  it("accepts safe six-digit colors and a hosted logo", () => {
    expect(customerBrandingSchema.parse({ name: "Meridian Cinema", logoUrl: "https://example.com/logo.svg", accentColor: "#fe2c54" })).toEqual({ name: "Meridian Cinema", logoUrl: "https://example.com/logo.svg", accentColor: "#fe2c54" });
  });

  it("supports null overrides for resetting to Attend defaults", () => {
    expect(customerBrandingSchema.parse({ logoUrl: null, accentColor: null, textColor: null })).toEqual({ logoUrl: null, accentColor: null, textColor: null });
  });

  it("rejects unsafe or ambiguous color strings", () => {
    expect(() => customerBrandingSchema.parse({ accentColor: "red" })).toThrow();
    expect(() => customerBrandingSchema.parse({ backgroundColor: "#fff" })).toThrow();
  });
});

describe("cinema programming requests", () => {
  const showtime = {
    movieId: "10000000-0000-4000-8000-000000000001",
    auditoriumId: "10000000-0000-4000-8000-000000000002",
    priceTierId: "10000000-0000-4000-8000-000000000003",
    startsAt: "2026-08-04T18:00:00.000Z",
  };

  it("accepts movie metadata with either an absolute or app-relative poster URL", () => {
    const parsed = createMovieRequestSchema.parse({
      title: "The Matrix",
      runtimeMinutes: 136,
      synopsis: "A programmer discovers the world is not what it seems.",
      rating: "R",
      posterUrl: "https://images.example.com/matrix.jpg",
      detailPosterUrl: "/posters/matrix-one-sheet.jpg",
      posterPosition: "BOTTOM",
      detailPosterPosition: "TOP",
      diningSpecialArtworkUrl: "/specials/matrix-paired-menu.jpg",
      diningSpecialTitle: "There Is No Spoonful",
      director: "Lana Wachowski, Lilly Wachowski",
      starring: "Keanu Reeves, Carrie-Anne Moss",
      trailerUrl: "https://video.example.com/matrix",
      releaseYear: 1999,
      pairingMenuItemIds: ["10000000-0000-4000-8000-000000000005"],
    });
    expect(parsed.posterUrl).toContain("images.example.com");
    expect(parsed.detailPosterUrl).toBe("/posters/matrix-one-sheet.jpg");
    expect(parsed.posterPosition).toBe("BOTTOM");
    expect(parsed.detailPosterPosition).toBe("TOP");
    expect(parsed.diningSpecialArtworkUrl).toBe("/specials/matrix-paired-menu.jpg");
    expect(parsed.diningSpecialTitle).toBe("There Is No Spoonful");
    expect(parsed.releaseYear).toBe(1999);
    expect(parsed.pairingMenuItemIds).toHaveLength(1);

    const defaults = createMovieRequestSchema.parse({
      title: "The Matrix",
      runtimeMinutes: 136,
      posterUrl: "/posters/matrix.jpg",
    });
    expect(defaults.posterUrl).toBe("/posters/matrix.jpg");
    expect(defaults.posterPosition).toBe("CENTER");
    expect(defaults.detailPosterPosition).toBe("CENTER");
    expect(() => createMovieRequestSchema.parse({ title: "The Matrix", runtimeMinutes: 136, posterPosition: "LEFT" })).toThrow();
  });

  it("accepts tiered distributor deal terms", () => {
    const parsed = createMovieRequestSchema.parse({
      title: "Tony",
      runtimeMinutes: 137,
      distributorName: "Example Distribution",
      distributorTerms: [
        { startWeek: 1, endWeek: 1, distributorShareBasisPoints: 6000 },
        { startWeek: 2, endWeek: null, distributorShareBasisPoints: 5000 },
      ],
    });

    expect(parsed.distributorName).toBe("Example Distribution");
    expect(parsed.distributorTerms?.[0]?.distributorShareBasisPoints).toBe(6000);
  });

  it("rejects overlapping distributor deal periods", () => {
    expect(() => createMovieRequestSchema.parse({
      title: "Tony",
      runtimeMinutes: 137,
      distributorTerms: [
        { startWeek: 1, endWeek: 2, distributorShareBasisPoints: 6000 },
        { startWeek: 2, endWeek: null, distributorShareBasisPoints: 5000 },
      ],
    })).toThrow();
  });

  it("stores a managed film-series assignment and presentation on a new showtime", () => {
    const filmSeriesId = "10000000-0000-4000-8000-000000000004";
    const parsed = createShowtimeRequestSchema.parse({
      ...showtime,
      filmSeriesId,
      presentation: "Q_AND_A",
      format: "35mm",
    });

    expect(parsed.filmSeriesId).toBe(filmSeriesId);
    expect(parsed.presentation).toBe("Q_AND_A");
    expect(parsed.format).toBe("35mm");
    expect(parsed.onSale).toBe(true);
  });

  it("accepts a multi-day schedule copy and rejects the source as a target", () => {
    expect(duplicateShowtimeDayRequestSchema.parse({
      sourceDate: "2026-08-06",
      targetDates: ["2026-08-07", "2026-08-08"],
    })).toEqual({
      sourceDate: "2026-08-06",
      targetDates: ["2026-08-07", "2026-08-08"],
      saleStatus: "PRESERVE",
    });
    expect(() => duplicateShowtimeDayRequestSchema.parse({
      sourceDate: "2026-08-06",
      targetDates: ["2026-08-06"],
    })).toThrow();
  });

  it("validates film-series create, edit, and archive payloads", () => {
    const createdSeries = createFilmSeriesRequestSchema.parse({
      name: "Summer Classics",
      description: "A repertory season.",
      artworkUrl: "/series/summer-classics.jpg",
      sortOrder: 3,
    });
    expect(createdSeries.name).toBe("Summer Classics");
    expect(createdSeries.sortOrder).toBe(3);
    expect(updateFilmSeriesRequestSchema.parse({ active: false })).toEqual({ active: false });
    expect(() => updateFilmSeriesRequestSchema.parse({})).toThrow();
  });

  it("does not reset sale or presentation values on an unrelated partial update", () => {
    expect(updateShowtimeRequestSchema.parse({ startsAt: showtime.startsAt })).toEqual({
      startsAt: showtime.startsAt,
    });
  });

  it("validates atomic multi-showtime moves", () => {
    const moves = [
      { showtimeId: "10000000-0000-4000-8000-000000000011", startsAt: "2026-08-04T19:00:00.000Z" },
      { showtimeId: "10000000-0000-4000-8000-000000000012", auditoriumId: "10000000-0000-4000-8000-000000000013", startsAt: "2026-08-04T20:00:00.000Z" },
    ];

    expect(moveShowtimeGroupRequestSchema.parse({ moves }).moves).toHaveLength(2);
    expect(moveShowtimeGroupRequestSchema.parse({ moves }).moves[1]?.auditoriumId).toBe("10000000-0000-4000-8000-000000000013");
    expect(() => moveShowtimeGroupRequestSchema.parse({ moves: moves.slice(0, 1) })).toThrow();
    expect(() => moveShowtimeGroupRequestSchema.parse({ moves: [moves[0], moves[0]] })).toThrow();
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
    presentation: "STANDARD",
    auditorium: { id: auditoriumId, name: "Theater 1", capacity: 60 },
    priceTier: { name: "Standard", ticketPriceMinor: 1700, feeMinor: 200, currency: "USD" },
    filmSeries: null,
    format: null,
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
