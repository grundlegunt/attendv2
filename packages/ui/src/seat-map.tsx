export interface SeatMapSeat {
  id?: string;
  label: string;
  x: number;
  y: number;
  type: "STANDARD" | "ADA" | "COMPANION";
  tableGroupId?: string | null;
  tablePosition?: "LEFT" | "RIGHT" | null;
  state?: "available" | "selected" | "unavailable";
}

export type SeatMapSeatingStyle = "SINGLE" | "PAIR" | "LOVESEAT" | "TABLE_2" | "TABLE_4" | "BENCH";

function pairedSeatPositions(seats: SeatMapSeat[], seatingStyle: SeatMapSeatingStyle) {
  const positions = new Map<SeatMapSeat, "left" | "right">();
  if (seatingStyle !== "PAIR" && seatingStyle !== "LOVESEAT") return positions;
  const rows = new Map<number, SeatMapSeat[]>();
  for (const seat of seats) rows.set(seat.y, [...(rows.get(seat.y) ?? []), seat]);
  for (const row of rows.values()) {
    const sorted = row.sort((left, right) => left.x - right.x);
    let run: SeatMapSeat[] = [];
    const pairRun = () => {
      for (let index = 0; index + 1 < run.length; index += 2) {
        positions.set(run[index]!, "left");
        positions.set(run[index + 1]!, "right");
      }
      run = [];
    };
    for (const seat of sorted) {
      if (run.length && seat.x !== run[run.length - 1]!.x + 1) pairRun();
      run.push(seat);
    }
    pairRun();
  }
  return positions;
}

export function SeatMap({
  seats,
  label = "Auditorium seat map",
  onSeatClick,
  allowUnavailableSelection = false,
  seatingStyle = "SINGLE",
}: {
  seats: SeatMapSeat[];
  label?: string;
  onSeatClick?: (seat: SeatMapSeat) => void;
  allowUnavailableSelection?: boolean;
  seatingStyle?: SeatMapSeatingStyle;
}) {
  const columns = Math.max(1, ...seats.map((seat) => seat.x + 1));
  const rows = Math.max(1, ...seats.map((seat) => seat.y + 1));
  const pairPositions = pairedSeatPositions(seats, seatingStyle);
  return (
    <section className="seat-map" aria-label={label}>
      <div className="seat-map__orientation">FRONT OF THEATER</div>
      <div className="seat-map__screen" aria-hidden="true" />
      <div
        className="seat-map__grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(32px, 44px))`,
          gridTemplateRows: `repeat(${rows}, 36px)`,
        }}
      >
        {seats.map((seat) => (
          <button
            key={seat.id ?? seat.label}
            type="button"
            className={`seat seat--${seat.state ?? "available"} ${
              seat.tablePosition ? `seat--paired-${seat.tablePosition.toLowerCase()}` : pairPositions.get(seat) ? `seat--paired-${pairPositions.get(seat)}` : ""
            }`}
            style={{ gridColumn: seat.x + 1, gridRow: seat.y + 1 }}
            title={`${seat.label}${seat.type !== "STANDARD" ? ` · ${seat.type}` : ""}`}
            aria-label={`${seat.label}, ${seat.type.toLowerCase()}`}
            aria-pressed={seat.state === "selected"}
            disabled={
              !onSeatClick ||
              (seat.state === "unavailable" && !allowUnavailableSelection)
            }
            onClick={onSeatClick ? () => onSeatClick(seat) : undefined}
          >
            <span>{seat.type === "ADA" ? "♿" : seat.type === "COMPANION" ? "C" : seat.label}</span>
          </button>
        ))}
      </div>
      <div className="seat-map__orientation">BACK OF THEATER</div>
      <div className="seat-map__legend" aria-label="Seat map legend">
        <span><i className="seat seat--available" /> Available</span>
        <span><i className="seat seat--unavailable" /> Unavailable</span>
        <span><i className="seat seat--selected" /> Selected</span>
      </div>
    </section>
  );
}
