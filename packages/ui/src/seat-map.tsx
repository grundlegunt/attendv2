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

export function SeatMap({
  seats,
  label = "Auditorium seat map",
  onSeatClick,
}: {
  seats: SeatMapSeat[];
  label?: string;
  onSeatClick?: (seat: SeatMapSeat) => void;
}) {
  const columns = Math.max(1, ...seats.map((seat) => seat.x + 1));
  const rows = Math.max(1, ...seats.map((seat) => seat.y + 1));
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
              seat.tablePosition ? `seat--${seat.tablePosition.toLowerCase()}` : ""
            }`}
            style={{ gridColumn: seat.x + 1, gridRow: seat.y + 1 }}
            title={`${seat.label}${seat.type !== "STANDARD" ? ` · ${seat.type}` : ""}`}
            aria-label={`${seat.label}, ${seat.type.toLowerCase()}`}
            aria-pressed={seat.state === "selected"}
            disabled={!onSeatClick || seat.state === "unavailable"}
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
