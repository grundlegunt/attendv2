import { showtimeDateStrip } from "./showtime-date-strip";

describe("showtimeDateStrip", () => {
  it("keeps the three-day header anchored to today for a visible selection", () => {
    expect(showtimeDateStrip("2026-08-13", "2026-08-14")).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
  });

  it("moves the header to a date selected from the calendar", () => {
    expect(showtimeDateStrip("2026-08-13", "2026-09-05")).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
    ]);
  });

  it("continues correctly across month boundaries", () => {
    expect(showtimeDateStrip("2026-08-31", null)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });
});
