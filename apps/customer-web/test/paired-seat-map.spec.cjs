const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const picker = readFileSync(resolve(__dirname, "../app/components/seat-picker.tsx"), "utf8");
const seatMap = readFileSync(resolve(__dirname, "../../../packages/ui/src/seat-map.tsx"), "utf8");
const theme = readFileSync(resolve(__dirname, "../../../packages/ui/src/theme.css"), "utf8");
const cinemaService = readFileSync(resolve(__dirname, "../../api/src/cinema/cinema.service.ts"), "utf8");

test("public availability carries the saved auditorium seating style into the shared map", () => {
  assert.match(cinemaService, /seatMapLayoutSchema\.safeParse\(showtime\.auditorium\.seatMap\?\.layoutJson\)/);
  assert.match(cinemaService, /seatingStyle: seatMapLayout\.success \? seatMapLayout\.data\.seatingStyle : "SINGLE"/);
  assert.match(picker, /seatingStyle=\{availability\?\.showtime\.auditorium\.seatingStyle \?\? "SINGLE"\}/);
});

test("paired layouts join adjacent seats without pairing across an aisle", () => {
  assert.match(seatMap, /seatingStyle !== "PAIR" && seatingStyle !== "LOVESEAT"/);
  assert.match(seatMap, /seat\.x !== run\[run\.length - 1\]!\.x \+ 1/);
  assert.match(seatMap, /seat--paired-/);
  assert.match(theme, /\.seat--paired-left/);
  assert.match(theme, /\.seat--paired-right/);
});
