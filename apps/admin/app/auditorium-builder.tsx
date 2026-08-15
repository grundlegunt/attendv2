"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type {
  AuditoriumSeatingMode,
  SeatInput,
  SeatMapLayout,
} from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch } from "./lib/api-client";

type Tool =
  | "STANDARD"
  | "ADA"
  | "COMPANION"
  | "AISLE"
  | "STAIRWAY"
  | "WALL"
  | "DOOR"
  | "EXIT"
  | "TABLE"
  | "LABEL"
  | "NOT_A_SEAT"
  | "ACCESSIBLE_PLATFORM"
  | "SELECT";
type LayoutElement = SeatMapLayout["elements"][number];

interface AuditoriumSummary {
  id: string;
  name: string;
  capacity: number;
  seatingMode: AuditoriumSeatingMode;
  seatMap: {
    id?: string;
    name?: string;
    version?: number;
    layoutJson?: SeatMapLayout | null;
    seats: Array<
      SeatMapSeat & {
        rowLabel?: string;
        number?: number;
        levelKey?: string | null;
        sectionKey?: string | null;
      }
    >;
  } | null;
}

const defaultLevel = {
  id: "main",
  name: "Main floor",
  sortOrder: 0,
  elevationLabel: "Floor",
};

function basicSeats(rows: number, seatsPerRow: number): SeatInput[] {
  return Array.from({ length: rows }, (_, rowIndex) => {
    const rowLabel = String.fromCharCode(65 + rowIndex);
    return Array.from({ length: seatsPerRow }, (_, seatIndex) => {
      const number = seatIndex + 1;
      const accessible = rowIndex === rows - 1 && seatIndex < 2;
      return {
        label: `${rowLabel}${number}`,
        rowLabel,
        number,
        x: seatIndex,
        y: rowIndex,
        type: accessible
          ? seatIndex === 0
            ? ("ADA" as const)
            : ("COMPANION" as const)
          : ("STANDARD" as const),
        tableGroupId: `${rowLabel}-${Math.floor(seatIndex / 2) + 1}`,
        tablePosition:
          seatIndex % 2 === 0 ? ("LEFT" as const) : ("RIGHT" as const),
        levelKey: "main",
      };
    });
  }).flat();
}

function baseLayout(mode: "BASIC" | "ADVANCED" = "ADVANCED"): SeatMapLayout {
  return {
    mode,
    canvas: { width: 24, height: 14 },
    screenPosition: "TOP",
    seatingStyle: "SINGLE",
    levels: [defaultLevel],
    sections: [],
    elements: [],
  };
}

function renumberLevelSeats(
  seats: SeatInput[],
  levelId: string,
  reverse = false,
): SeatInput[] {
  const rows = new Map<number, SeatInput[]>();
  for (const seat of seats.filter(
    (candidate) => (candidate.levelKey ?? "main") === levelId,
  )) {
    rows.set(seat.y, [...(rows.get(seat.y) ?? []), seat]);
  }

  const labels = new Map<
    SeatInput,
    Pick<SeatInput, "label" | "rowLabel" | "number">
  >();
  [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([_y, row], rowIndex) => {
      const rowLabel = String.fromCharCode(65 + Math.min(rowIndex, 25));
      const sorted = row.sort((a, b) => a.x - b.x);
      sorted.forEach((seat, index) => {
        const number = reverse ? sorted.length - index : index + 1;
        labels.set(seat, {
          label: `${levelId === "main" ? "" : "B"}${rowLabel}${number}`,
          rowLabel,
          number,
        });
      });
    });

  return seats.map((seat) => ({ ...seat, ...(labels.get(seat) ?? {}) }));
}

function renumberAllSeats(
  seats: SeatInput[],
  layout: SeatMapLayout,
): SeatInput[] {
  return layout.levels.reduce(
    (numbered, level) => renumberLevelSeats(numbered, level.id),
    seats,
  );
}

function template(name: string): { seats: SeatInput[]; layout: SeatMapLayout } {
  const layout = baseLayout();
  const rows = name === "accessible" ? 5 : name === "stadium" ? 8 : 6;
  const count = name === "two-aisle" ? 16 : 12;
  const seats = basicSeats(rows, count).map((seat) => {
    let x = seat.x;
    if (name === "center-aisle" && seat.x >= count / 2) x += 2;
    if (name === "two-aisle")
      ((x += seat.x >= 4 ? 2 : 0), (x += seat.x >= 12 ? 2 : 0));
    if (name === "accessible" && seat.y === rows - 1 && seat.x < 4) {
      return {
        ...seat,
        x,
        type: seat.x % 2 === 0 ? ("ADA" as const) : ("COMPANION" as const),
      };
    }
    return { ...seat, x };
  });
  if (name === "center-aisle")
    layout.elements.push({
      id: "aisle-center",
      type: "AISLE",
      levelId: "main",
      x: 6,
      y: 0,
      width: 2,
      height: rows,
      label: "Center aisle",
      orientation: "VERTICAL",
    });
  if (name === "two-aisle")
    layout.elements.push(
      {
        id: "aisle-left",
        type: "AISLE",
        levelId: "main",
        x: 4,
        y: 0,
        width: 2,
        height: rows,
        label: "Left aisle",
        orientation: "VERTICAL",
      },
      {
        id: "aisle-right",
        type: "AISLE",
        levelId: "main",
        x: 14,
        y: 0,
        width: 2,
        height: rows,
        label: "Right aisle",
        orientation: "VERTICAL",
      },
    );
  if (name === "balcony") {
    layout.levels.push({
      id: "balcony",
      name: "Balcony",
      sortOrder: 1,
      elevationLabel: "Upper level",
    });
    seats.push(
      ...basicSeats(3, 10).map((seat) => ({
        ...seat,
        label: `B${seat.label}`,
        rowLabel: `B${seat.rowLabel}`,
        levelKey: "balcony",
      })),
    );
  }
  if (name === "dine-in") {
    layout.seatingStyle = "TABLE_2";
    for (const seat of seats) {
      seat.tableGroupId = `${seat.rowLabel}-${Math.floor((seat.number - 1) / 2) + 1}`;
      seat.tablePosition = seat.number % 2 === 1 ? "LEFT" : "RIGHT";
    }
    for (let y = 0; y < rows; y += 1)
      for (let x = 0; x < count; x += 2) {
        layout.elements.push({
          id: `table-${x}-${y}`,
          type: "TABLE",
          levelId: "main",
          x,
          y,
          width: 2,
          height: 1,
          label: `Table ${y + 1}-${x / 2 + 1}`,
        });
      }
  }
  return { seats, layout };
}

export function AuditoriumBuilder({
  accessToken,
  auditoriums,
  onSaved,
  onError,
}: {
  accessToken: string;
  auditoriums: AuditoriumSummary[];
  onSaved: (message: string) => Promise<void> | void;
  onError: (reason: unknown) => void;
}) {
  const [mode, setMode] = useState<"BASIC" | "ADVANCED">("BASIC");
  const [name, setName] = useState("Theater 1");
  const [seatingMode, setSeatingMode] =
    useState<AuditoriumSeatingMode>("RESERVED");
  const [gaCapacity, setGaCapacity] = useState(100);
  const [rows, setRows] = useState(8);
  const [seatsPerRow, setSeatsPerRow] = useState(12);
  const [editingId, setEditingId] = useState("");
  const [layout, setLayout] = useState<SeatMapLayout>(baseLayout());
  const [seats, setSeats] = useState<SeatInput[]>(
    () => template("center-aisle").seats,
  );
  const [levelId, setLevelId] = useState("main");
  const [tool, setTool] = useState<Tool>("SELECT");
  const [selected, setSelected] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"ADMIN" | "CUSTOMER">("ADMIN");
  const history = useRef<Array<{ seats: SeatInput[]; layout: SeatMapLayout }>>(
    [],
  );
  const future = useRef<Array<{ seats: SeatInput[]; layout: SeatMapLayout }>>(
    [],
  );

  const preview = useMemo(
    () => (mode === "BASIC" ? basicSeats(rows, seatsPerRow) : seats),
    [mode, rows, seatsPerRow, seats],
  );
  const activeSeats = preview.filter(
    (seat) => (seat.levelKey ?? "main") === levelId,
  );
  const activeElements = layout.elements.filter(
    (element) => element.levelId === levelId,
  );
  const counts = useMemo(
    () => ({
      standard: preview.filter((seat) => seat.type === "STANDARD").length,
      ada: preview.filter((seat) => seat.type === "ADA").length,
      companion: preview.filter((seat) => seat.type === "COMPANION").length,
    }),
    [preview],
  );
  const selectedElement = layout.elements.find((element) =>
    selected.includes(`element:${element.id}`),
  );
  const blockedPositions = layout.elements.filter(
    (element) => element.type === "NOT_A_SEAT",
  ).length;

  function snapshot() {
    history.current.push({
      seats: structuredClone(seats),
      layout: structuredClone(layout),
    });
    future.current = [];
  }
  function undo() {
    const previous = history.current.pop();
    if (previous) {
      future.current.push({
        seats: structuredClone(seats),
        layout: structuredClone(layout),
      });
      setSeats(previous.seats);
      setLayout(previous.layout);
      setSelected([]);
    }
  }
  function redo() {
    const next = future.current.pop();
    if (next) {
      history.current.push({
        seats: structuredClone(seats),
        layout: structuredClone(layout),
      });
      setSeats(next.seats);
      setLayout(next.layout);
      setSelected([]);
    }
  }
  function loadTemplate(value: string) {
    snapshot();
    const next = template(value);
    setSeats(next.seats);
    setLayout(next.layout);
    setLevelId(next.layout.levels[0]!.id);
  }

  function selectAuditorium(id: string) {
    setEditingId(id);
    const room = auditoriums.find((candidate) => candidate.id === id);
    if (!room) return;
    setName(room.name);
    setSeatingMode(room.seatingMode ?? "RESERVED");
    setGaCapacity(room.capacity);
    if (!room.seatMap) return;
    const nextLayout = room.seatMap.layoutJson ?? baseLayout("ADVANCED");
    setLayout(nextLayout);
    setMode(nextLayout.mode);
    setSeats(
      room.seatMap.seats.map((seat, index) => ({
        label: seat.label,
        rowLabel: seat.rowLabel ?? (seat.label.replace(/\d+$/, "") || "A"),
        number: seat.number ?? index + 1,
        x: seat.x,
        y: seat.y,
        type: seat.type,
        tableGroupId: seat.tableGroupId,
        tablePosition: seat.tablePosition,
        levelKey: seat.levelKey ?? "main",
        sectionKey: seat.sectionKey,
      })),
    );
    if (nextLayout.mode === "BASIC") {
      setRows(Math.max(1, ...room.seatMap.seats.map((seat) => seat.y + 1)));
      setSeatsPerRow(
        Math.max(2, ...room.seatMap.seats.map((seat) => seat.x + 1)),
      );
    }
    setLevelId(nextLayout.levels[0]?.id ?? "main");
  }

  function startNewAuditorium() {
    setEditingId("");
    setName(`Theater ${auditoriums.length + 1}`);
    setSeatingMode("RESERVED");
    setGaCapacity(100);
    setMode("BASIC");
    setRows(8);
    setSeatsPerRow(12);
    setLayout(baseLayout());
    setSeats(template("center-aisle").seats);
    setLevelId("main");
    setSelected([]);
    history.current = [];
    future.current = [];
  }

  function addLevel() {
    const id = `level-${layout.levels.length + 1}`;
    snapshot();
    setLayout((current) => ({
      ...current,
      levels: [
        ...current.levels,
        {
          id,
          name: `Level ${current.levels.length + 1}`,
          sortOrder: current.levels.length,
          elevationLabel: null,
        },
      ],
    }));
    setLevelId(id);
  }

  function addSection() {
    const name = window.prompt("Section name", "Center");
    if (!name) return;
    snapshot();
    setLayout((current) => ({
      ...current,
      sections: [
        ...current.sections,
        { id: `section-${crypto.randomUUID()}`, levelId, name },
      ],
    }));
  }

  function updateLevel(patch: {
    name?: string;
    elevationLabel?: string | null;
  }) {
    snapshot();
    setLayout((current) => ({
      ...current,
      levels: current.levels.map((level) =>
        level.id === levelId ? { ...level, ...patch } : level,
      ),
    }));
  }

  function place(x: number, y: number) {
    if (tool === "SELECT") return;
    snapshot();
    if (["STANDARD", "ADA", "COMPANION"].includes(tool)) {
      setSeats((current) =>
        renumberLevelSeats(
          [
            ...current.filter(
              (seat) =>
                !(
                  seat.x === x &&
                  seat.y === y &&
                  (seat.levelKey ?? "main") === levelId
                ),
            ),
            {
              label: `NEW-${crypto.randomUUID()}`,
              rowLabel: "",
              number: 0,
              x,
              y,
              type: tool as SeatInput["type"],
              levelKey: levelId,
            },
          ],
          levelId,
        ),
      );
    } else {
      const element: LayoutElement = {
        id: `${tool.toLowerCase()}-${crypto.randomUUID()}`,
        type: tool as LayoutElement["type"],
        levelId,
        x,
        y,
        width: tool === "WALL" ? 4 : 1,
        height: 1,
        label: tool.replaceAll("_", " "),
        orientation: "HORIZONTAL",
      };
      setLayout((current) => ({
        ...current,
        elements: [...current.elements, element],
      }));
    }
  }

  function removeSelected() {
    if (!selected.length) return;
    snapshot();
    setSeats((current) =>
      current.filter(
        (seat) =>
          !selected.includes(`seat:${seat.levelKey ?? "main"}:${seat.label}`),
      ),
    );
    setLayout((current) => ({
      ...current,
      elements: current.elements.filter(
        (element) => !selected.includes(`element:${element.id}`),
      ),
    }));
    setSelected([]);
  }

  function moveDragged(x: number, y: number) {
    if (!dragged) return;
    snapshot();
    if (dragged.startsWith("seat:")) {
      setSeats((current) => {
        const moved = current.find(
          (seat) => dragged === `seat:${seat.levelKey ?? "main"}:${seat.label}`,
        );
        if (!moved) return current;
        const movedLevel = moved.levelKey ?? "main";
        const occupant = current.find(
          (seat) =>
            seat !== moved &&
            (seat.levelKey ?? "main") === movedLevel &&
            seat.x === x &&
            seat.y === y,
        );
        const repositioned = current.map((seat) => {
          if (seat === moved) return { ...seat, x, y };
          if (seat === occupant) return { ...seat, x: moved.x, y: moved.y };
          return seat;
        });
        return renumberLevelSeats(repositioned, movedLevel);
      });
    } else if (dragged.startsWith("element:")) {
      const id = dragged.slice("element:".length);
      setLayout((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === id
            ? {
                ...element,
                x: Math.min(x, current.canvas.width - element.width),
                y: Math.min(y, current.canvas.height - element.height),
              }
            : element,
        ),
      }));
    }
    setDragged(null);
  }

  function duplicateSelected() {
    if (!selected.length) return;
    snapshot();
    const copiedSeats = seats
      .filter((seat) =>
        selected.includes(`seat:${seat.levelKey ?? "main"}:${seat.label}`),
      )
      .map((seat) => ({
        ...seat,
        label: `${seat.label}-COPY`,
        x: Math.min(seat.x + 1, layout.canvas.width - 1),
        number: seat.number + 1000,
        tableGroupId: seat.tableGroupId ? `${seat.tableGroupId}-copy` : null,
      }));
    const copiedElements = layout.elements
      .filter((element) => selected.includes(`element:${element.id}`))
      .map((element) => ({
        ...element,
        id: `${element.type.toLowerCase()}-${crypto.randomUUID()}`,
        x: Math.min(element.x + 1, layout.canvas.width - element.width),
      }));
    setSeats((current) => [...current, ...copiedSeats]);
    setLayout((current) => ({
      ...current,
      elements: [...current.elements, ...copiedElements],
    }));
    setSelected([]);
  }

  function mirrorSelected() {
    snapshot();
    setSeats((current) =>
      current.map((seat) =>
        selected.includes(`seat:${seat.levelKey ?? "main"}:${seat.label}`)
          ? { ...seat, x: layout.canvas.width - 1 - seat.x }
          : seat,
      ),
    );
    setLayout((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selected.includes(`element:${element.id}`)
          ? { ...element, x: current.canvas.width - element.width - element.x }
          : element,
      ),
    }));
  }

  function alignSelected(axis: "x" | "y") {
    const chosenSeats = seats.filter((seat) =>
      selected.includes(`seat:${seat.levelKey ?? "main"}:${seat.label}`),
    );
    const chosenElements = layout.elements.filter((element) =>
      selected.includes(`element:${element.id}`),
    );
    const anchor = chosenSeats[0]?.[axis] ?? chosenElements[0]?.[axis];
    if (anchor === undefined) return;
    snapshot();
    setSeats((current) =>
      current.map((seat) =>
        selected.includes(`seat:${seat.levelKey ?? "main"}:${seat.label}`)
          ? { ...seat, [axis]: anchor }
          : seat,
      ),
    );
    setLayout((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selected.includes(`element:${element.id}`)
          ? { ...element, [axis]: anchor }
          : element,
      ),
    }));
  }

  function autoNumber(reverse = false) {
    snapshot();
    setSeats((current) => renumberLevelSeats(current, levelId, reverse));
    setSelected([]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const finalLayout: SeatMapLayout =
      mode === "BASIC"
        ? {
            ...baseLayout("BASIC"),
            canvas: { width: seatsPerRow, height: rows },
          }
        : { ...layout, mode: "ADVANCED" };
    const finalSeats =
      mode === "BASIC"
        ? basicSeats(rows, seatsPerRow)
        : renumberAllSeats(seats, finalLayout);
    try {
      await apiFetch(
        editingId
          ? `/cinema/auditoriums/${editingId}/layout`
          : "/cinema/auditoriums",
        {
          accessToken,
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(
            seatingMode === "GENERAL_ADMISSION"
              ? { name, seatingMode, capacity: gaCapacity }
              : {
                  name,
                  seatingMode,
                  seatMapName: `${name} layout`,
                  seats: finalSeats,
                  layout: finalLayout,
                },
          ),
        },
      );
      await onSaved(
        editingId
          ? `${name} layout version saved. Existing showtimes keep their original seats.`
          : `${name} created.`,
      );
    } catch (reason) {
      onError(reason);
    }
  }

  async function duplicate() {
    if (!editingId) return;
    const copyName = window.prompt(
      "Name for the duplicated theater",
      `${name} copy`,
    );
    if (!copyName) return;
    try {
      await apiFetch(`/cinema/auditoriums/${editingId}/duplicate`, {
        accessToken,
        method: "POST",
        body: JSON.stringify({ name: copyName }),
      });
      await onSaved(`${copyName} created from ${name}.`);
    } catch (reason) {
      onError(reason);
    }
  }

  async function deactivate() {
    if (
      !editingId ||
      !window.confirm(
        `Deactivate ${name}? It will disappear from setup and scheduling. Historical showtimes will be preserved.`,
      )
    )
      return;
    try {
      await apiFetch(`/cinema/auditoriums/${editingId}`, {
        accessToken,
        method: "DELETE",
      });
      setEditingId("");
      setName("Theater 1");
      setSeatingMode("RESERVED");
      setGaCapacity(100);
      setMode("BASIC");
      setRows(8);
      setSeatsPerRow(12);
      await onSaved(
        `${name} was deactivated. Historical records were preserved.`,
      );
    } catch (reason) {
      onError(reason);
    }
  }

  return (
    <form className="panel auditorium-builder" onSubmit={save}>
      <div className="auditorium-picker">
        <div className="setup-rail-heading">
          <p className="kicker">AUDITORIUMS</p>
          <button type="button" onClick={startNewAuditorium}>
            + Add
          </button>
        </div>
        <div className="auditorium-options">
          {auditoriums.map((room) => (
            <button
              type="button"
              key={room.id}
              className={editingId === room.id ? "active" : ""}
              onClick={() => selectAuditorium(room.id)}
            >
              <strong>{room.name}</strong>
              <span>
                {room.capacity}{" "}
                {room.seatingMode === "GENERAL_ADMISSION"
                  ? "GA admissions"
                  : "seats"}
              </span>
            </button>
          ))}
          {!auditoriums.length && (
            <p className="builder-help">
              No auditoriums yet. Create the first one.
            </p>
          )}
        </div>
      </div>
      <div className="builder-heading">
        <div>
          <p className="kicker">AUDITORIUM CONFIGURATION</p>
          <h2>{editingId ? name : "Create an auditorium"}</h2>
          <p className="builder-help">
            {seatingMode === "GENERAL_ADMISSION"
              ? `${gaCapacity} general-admission tickets available per showtime`
              : editingId
                ? `${preview.length} sellable positions`
                : "Start with a quick grid or build a custom room."}
          </p>
        </div>
      </div>
      <div className="builder-mode" role="group" aria-label="Seating type">
        <button
          type="button"
          className={seatingMode === "RESERVED" ? "active" : ""}
          onClick={() => setSeatingMode("RESERVED")}
        >
          Reserved seats
        </button>
        <button
          type="button"
          className={seatingMode === "GENERAL_ADMISSION" ? "active" : ""}
          onClick={() => setSeatingMode("GENERAL_ADMISSION")}
        >
          General admission
        </button>
      </div>
      <label>
        Theater name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {seatingMode === "GENERAL_ADMISSION" ? (
        <div className="two-fields">
          <label>
            Sellable capacity
            <input
              type="number"
              min="1"
              max="500"
              required
              value={gaCapacity}
              onChange={(event) =>
                setGaCapacity(
                  Math.max(1, Math.min(500, Number(event.target.value))),
                )
              }
            />
          </label>
          <p className="builder-help">
            Customers choose a ticket quantity instead of individual seats.
            Capacity is enforced independently for every showtime.
          </p>
        </div>
      ) : (
        <>
          <div className="builder-mode" role="tablist">
            <button
              type="button"
              className={mode === "BASIC" ? "active" : ""}
              onClick={() => setMode("BASIC")}
            >
              Basic layout
            </button>
            <button
              type="button"
              className={mode === "ADVANCED" ? "active" : ""}
              onClick={() => setMode("ADVANCED")}
            >
              Advanced layout
            </button>
          </div>
          {mode === "BASIC" ? (
            <>
              <p className="builder-help">
                The fast workflow remains unchanged: choose rows and seats per
                row, preview, and save.
              </p>
              <div className="two-fields">
                <label>
                  Rows
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={rows}
                    onChange={(event) => setRows(Number(event.target.value))}
                  />
                </label>
                <label>
                  Seats per row
                  <input
                    type="number"
                    min="2"
                    max="30"
                    value={seatsPerRow}
                    onChange={(event) =>
                      setSeatsPerRow(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <SeatMap seats={preview} label={`${name} preview`} />
            </>
          ) : (
            <>
              <div className="advanced-toolbar">
                <label>
                  Template
                  <select
                    defaultValue="custom"
                    onChange={(event) =>
                      event.target.value !== "custom" &&
                      loadTemplate(event.target.value)
                    }
                  >
                    <option value="custom">Current/custom</option>
                    <option value="flat">Flat floor</option>
                    <option value="stadium">Stadium seating</option>
                    <option value="center-aisle">Center aisle</option>
                    <option value="two-aisle">Two aisles</option>
                    <option value="balcony">Balcony / two level</option>
                    <option value="dine-in">Dine-in table seating</option>
                    <option value="accessible">Accessible layout</option>
                  </select>
                </label>
                <label>
                  Screen
                  <select
                    value={layout.screenPosition}
                    onChange={(event) =>
                      setLayout((current) => ({
                        ...current,
                        screenPosition: event.target
                          .value as SeatMapLayout["screenPosition"],
                      }))
                    }
                  >
                    <option>TOP</option>
                    <option>BOTTOM</option>
                    <option>LEFT</option>
                    <option>RIGHT</option>
                  </select>
                </label>
                <label>
                  Seating style
                  <select
                    value={layout.seatingStyle}
                    onChange={(event) =>
                      setLayout((current) => ({
                        ...current,
                        seatingStyle: event.target
                          .value as SeatMapLayout["seatingStyle"],
                      }))
                    }
                  >
                    <option value="SINGLE">Single</option>
                    <option value="PAIR">Pairs</option>
                    <option value="LOVESEAT">Love seat</option>
                    <option value="TABLE_2">Table · 2</option>
                    <option value="TABLE_4">Table · 4</option>
                    <option value="BENCH">Bench / sofa</option>
                  </select>
                </label>
                <label>
                  Preview
                  <select
                    value={previewMode}
                    onChange={(event) =>
                      setPreviewMode(event.target.value as "ADMIN" | "CUSTOMER")
                    }
                  >
                    <option value="ADMIN">Admin detail</option>
                    <option value="CUSTOMER">Customer view</option>
                  </select>
                </label>
                <button type="button" className="secondary" onClick={undo}>
                  Undo
                </button>
                <button type="button" className="secondary" onClick={redo}>
                  Redo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={duplicateSelected}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => alignSelected("x")}
                >
                  Align column
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => alignSelected("y")}
                >
                  Align row
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={mirrorSelected}
                >
                  Mirror
                </button>
                <button
                  type="button"
                  className="secondary destructive-outline"
                  onClick={removeSelected}
                >
                  Delete selected
                </button>
              </div>
              <div className="level-tabs">
                {layout.levels.map((level) => (
                  <button
                    type="button"
                    className={level.id === levelId ? "active" : ""}
                    key={level.id}
                    onClick={() => setLevelId(level.id)}
                  >
                    {level.name}
                  </button>
                ))}
                <button type="button" onClick={addLevel}>
                  + Level
                </button>
              </div>
              <div className="level-settings">
                <label>
                  Level name
                  <input
                    key={`${levelId}:name`}
                    defaultValue={
                      layout.levels.find((level) => level.id === levelId)?.name
                    }
                    onBlur={(event) =>
                      updateLevel({ name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Elevation / tier label
                  <input
                    key={`${levelId}:elevation`}
                    defaultValue={
                      layout.levels.find((level) => level.id === levelId)
                        ?.elevationLabel ?? ""
                    }
                    onBlur={(event) =>
                      updateLevel({
                        elevationLabel: event.target.value || null,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={addSection}
                >
                  + Section
                </button>
                {layout.sections
                  .filter((section) => section.levelId === levelId)
                  .map((section) => (
                    <span className="section-chip" key={section.id}>
                      {section.name}
                    </span>
                  ))}
              </div>
              <div className="element-palette" aria-label="Layout tools">
                {(
                  [
                    "SELECT",
                    "STANDARD",
                    "ADA",
                    "COMPANION",
                    "NOT_A_SEAT",
                    "AISLE",
                    "STAIRWAY",
                    "WALL",
                    "DOOR",
                    "EXIT",
                    "ACCESSIBLE_PLATFORM",
                    "TABLE",
                    "LABEL",
                  ] as Tool[]
                ).map((item) => (
                  <button
                    type="button"
                    className={tool === item ? "active" : ""}
                    key={item}
                    onClick={() => setTool(item)}
                  >
                    {item.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
              <div className="numbering-tools">
                <span>Seat numbering</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => autoNumber(false)}
                >
                  Left → right
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => autoNumber(true)}
                >
                  Right → left
                </button>
              </div>
              {selectedElement && (
                <div className="element-inspector">
                  <strong>
                    Selected{" "}
                    {selectedElement.type.replaceAll("_", " ").toLowerCase()}
                  </strong>
                  <label>
                    Label
                    <input
                      value={selectedElement.label ?? ""}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          elements: current.elements.map((element) =>
                            element.id === selectedElement.id
                              ? { ...element, label: event.target.value }
                              : element,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Width
                    <input
                      type="number"
                      min="1"
                      max={layout.canvas.width - selectedElement.x}
                      value={selectedElement.width}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          elements: current.elements.map((element) =>
                            element.id === selectedElement.id
                              ? {
                                  ...element,
                                  width: Number(event.target.value),
                                }
                              : element,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      type="number"
                      min="1"
                      max={layout.canvas.height - selectedElement.y}
                      value={selectedElement.height}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          elements: current.elements.map((element) =>
                            element.id === selectedElement.id
                              ? {
                                  ...element,
                                  height: Number(event.target.value),
                                }
                              : element,
                          ),
                        }))
                      }
                    />
                  </label>
                </div>
              )}
              <p className="builder-help">
                Choose a tool, then click the grid. Select elements to mirror or
                delete. Sellable positions remain individual seats.
              </p>
              <div
                className={`layout-canvas screen-${layout.screenPosition.toLowerCase()}`}
                style={{
                  gridTemplateColumns: `repeat(${layout.canvas.width}, 32px)`,
                  gridTemplateRows: `repeat(${layout.canvas.height}, 32px)`,
                }}
              >
                {Array.from(
                  { length: layout.canvas.width * layout.canvas.height },
                  (_, index) => {
                    const x = index % layout.canvas.width;
                    const y = Math.floor(index / layout.canvas.width);
                    return (
                      <button
                        type="button"
                        className="canvas-cell"
                        aria-label={`Position ${x + 1}, ${y + 1}`}
                        key={`${x}:${y}`}
                        style={{ gridColumn: x + 1, gridRow: y + 1 }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => moveDragged(x, y)}
                        onClick={() => place(x, y)}
                      />
                    );
                  },
                )}
                {activeElements
                  .filter(
                    (element) =>
                      previewMode === "ADMIN" ||
                      [
                        "AISLE",
                        "TABLE",
                        "NOT_A_SEAT",
                        "WHEELCHAIR_SPACE",
                      ].includes(element.type),
                  )
                  .map((element) => {
                    const key = `element:${element.id}`;
                    return (
                      <button
                        type="button"
                        draggable
                        key={key}
                        className={`layout-element type-${element.type.toLowerCase()} ${selected.includes(key) ? "selected" : ""}`}
                        style={{
                          gridColumn: `${element.x + 1} / span ${element.width}`,
                          gridRow: `${element.y + 1} / span ${element.height}`,
                        }}
                        onDragStart={() => setDragged(key)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected((current) =>
                            current.includes(key)
                              ? current.filter((id) => id !== key)
                              : [...current, key],
                          );
                        }}
                      >
                        {element.label ?? element.type}
                      </button>
                    );
                  })}
                {activeSeats.map((seat) => {
                  const key = `seat:${seat.levelKey ?? "main"}:${seat.label}`;
                  return (
                    <button
                      type="button"
                      draggable
                      key={key}
                      className={`layout-seat type-${seat.type.toLowerCase()} ${selected.includes(key) ? "selected" : ""}`}
                      style={{ gridColumn: seat.x + 1, gridRow: seat.y + 1 }}
                      onDragStart={() => setDragged(key)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (tool === "SELECT")
                          setSelected((current) =>
                            current.includes(key)
                              ? current.filter((id) => id !== key)
                              : [...current, key],
                          );
                      }}
                    >
                      {seat.type === "ADA"
                        ? "♿"
                        : seat.type === "COMPANION"
                          ? "C"
                          : seat.label}
                    </button>
                  );
                })}
              </div>
              <div className="capacity-summary">
                <span>
                  Standard <b>{counts.standard}</b>
                </span>
                <span>
                  Wheelchair <b>{counts.ada}</b>
                </span>
                <span>
                  Companion <b>{counts.companion}</b>
                </span>
                <span>
                  Blocked / non-seat <b>{blockedPositions}</b>
                </span>
                <span>
                  Total admission capacity <b>{preview.length}</b>
                </span>
              </div>
            </>
          )}
        </>
      )}
      <div className="builder-actions">
        <button className="primary">
          {seatingMode === "GENERAL_ADMISSION"
            ? editingId
              ? "Save GA auditorium"
              : `Create ${gaCapacity}-capacity auditorium`
            : editingId
              ? "Save new layout version"
              : `Create ${preview.length}-seat auditorium`}
        </button>
        {editingId && (
          <button
            type="button"
            className="secondary"
            onClick={() => void duplicate()}
          >
            Duplicate theater
          </button>
        )}
        {editingId && (
          <button
            type="button"
            className="secondary destructive-outline"
            onClick={() => void deactivate()}
          >
            Deactivate theater
          </button>
        )}
      </div>
      <p className="compliance-note">
        Attend models the layout supplied by the operator. It does not certify
        ADA, fire, egress, or building-code compliance.
      </p>
    </form>
  );
}
