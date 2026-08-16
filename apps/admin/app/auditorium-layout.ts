import type { SeatInput, SeatMapLayout } from "@cinema/shared";

/**
 * Table pairing is only meaningful for two-seat table layouts. Older basic
 * layouts accidentally attached pair metadata to every seat, so moving or
 * deleting an ADA/companion position could orphan a pair and make an otherwise
 * valid layout fail API validation.
 */
export function normalizeSeatTableMetadata(
  seats: SeatInput[],
  seatingStyle: SeatMapLayout["seatingStyle"],
): SeatInput[] {
  if (seatingStyle === "TABLE_2") {
    return seats;
  }

  return seats.map(
    ({ tableGroupId: _group, tablePosition: _position, ...seat }) => seat,
  );
}

/**
 * Change the sellable position at a coordinate without discarding its table,
 * section, or numbering metadata. Replacing the whole seat used to leave the
 * other half of a table pair orphaned, so the API correctly rejected the
 * edited auditorium as invalid.
 */
export function replaceSeatTypeAtCoordinate(
  seats: SeatInput[],
  levelId: string,
  x: number,
  y: number,
  type: SeatInput["type"],
): SeatInput[] {
  const existing = seats.find(
    (seat) =>
      (seat.levelKey ?? "main") === levelId && seat.x === x && seat.y === y,
  );

  if (existing) {
    return seats.map((seat) =>
      seat === existing ? { ...seat, type } : seat,
    );
  }

  return [
    ...seats,
    {
      label: `NEW-${crypto.randomUUID()}`,
      rowLabel: "",
      number: 0,
      x,
      y,
      type,
      levelKey: levelId,
    },
  ];
}
