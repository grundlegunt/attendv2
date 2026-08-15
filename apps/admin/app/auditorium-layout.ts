import type { SeatInput } from "@cinema/shared";

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
