const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const source = readFileSync(join(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("Attend Master auditorium builder exposes every shared seating style", () => {
  assert.match(source, /seatingStyle: SeatMapLayout\["seatingStyle"\]/);
  for (const style of ["SINGLE", "PAIR", "LOVESEAT", "TABLE_2", "TABLE_4", "BENCH"]) {
    assert.match(source, new RegExp(`<option value="${style}">`), style);
  }
  assert.match(source, /seatingStyle: draft\.seatingStyle/);
  assert.match(source, /auditorium\.seatMap\?\.layout\?\.seatingStyle \?\?/);
});
