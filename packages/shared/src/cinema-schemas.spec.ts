import { showtimeWindowsOverlap, validateSeatLayout } from "./cinema-schemas";

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
