const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const picker = readFileSync(resolve(__dirname, "../app/components/seat-picker.tsx"), "utf8");
const seatMap = readFileSync(resolve(__dirname, "../../../packages/ui/src/seat-map.tsx"), "utf8");
const theme = readFileSync(resolve(__dirname, "../../../packages/ui/src/theme.css"), "utf8");
const cinemaService = readFileSync(resolve(__dirname, "../../api/src/cinema/cinema.service.ts"), "utf8");

test("public availability carries the saved auditorium seating style into the shared map", () => {
  assert.match(cinemaService, /function resolvedSeatingStyle/);
  assert.match(cinemaService, /seatingStyle: resolvedSeatingStyle\(/);
  assert.match(cinemaService, /positions\.has\("LEFT"\) && positions\.has\("RIGHT"\)/);
  assert.match(picker, /seatingStyle=\{availability\?\.showtime\.auditorium\.seatingStyle \?\? "SINGLE"\}/);
});

test("paired layouts join adjacent seats without pairing across an aisle", () => {
  assert.match(seatMap, /seatingStyle !== "PAIR" && seatingStyle !== "LOVESEAT"/);
  assert.match(seatMap, /seat\.x !== run\[run\.length - 1\]!\.x \+ 1/);
  assert.match(seatMap, /seat--paired-/);
  assert.match(theme, /\.seat--paired-left/);
  assert.match(theme, /\.seat--paired-right/);
  assert.match(theme, /border-radius: 12px 0 0 12px/);
  assert.match(theme, /border-radius: 0 12px 12px 0/);
});
