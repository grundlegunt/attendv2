import type { SeatInput, SeatMapLayout } from "@cinema/shared";

/**
 * Pair metadata is the persistent source of truth for every two-seat style.
 * Rebuild it from adjacent coordinates so editing a row cannot leave an
 * orphaned half behind. Aisles (coordinate gaps) deliberately break a run.
 */
export function normalizeSeatTableMetadata(
  seats: SeatInput[],
  seatingStyle: SeatMapLayout["seatingStyle"],
): SeatInput[] {
  if (seatingStyle === "TABLE_2") return seats;

  const ungrouped: SeatInput[] = seats.map(
    ({ tableGroupId: _group, tablePosition: _position, ...seat }) => seat,
  );
  if (seatingStyle !== "PAIR" && seatingStyle !== "LOVESEAT") return ungrouped;

  const grouped = ungrouped.map((seat) => ({ ...seat }));
  const rows = new Map<string, typeof grouped>();
  for (const seat of grouped) {
    const key = `${seat.levelKey ?? "main"}:${seat.y}`;
    rows.set(key, [...(rows.get(key) ?? []), seat]);
  }
  for (const row of rows.values()) {
    const sorted = row.sort((left, right) => left.x - right.x);
    let run: typeof grouped = [];
    const pairRun = () => {
      for (let index = 0; index + 1 < run.length; index += 2) {
        const left = run[index]!;
        const right = run[index + 1]!;
        const groupId = `p-${(left.levelKey ?? "main").slice(0, 12)}-${left.y}-${left.x}`;
        left.tableGroupId = groupId;
        left.tablePosition = "LEFT";
        right.tableGroupId = groupId;
        right.tablePosition = "RIGHT";
      }
      run = [];
    };
    for (const seat of sorted) {
      if (run.length && seat.x !== run[run.length - 1]!.x + 1) pairRun();
      run.push(seat);
    }
    pairRun();
  }
  return grouped;
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
