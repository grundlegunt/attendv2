const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("selected showtime reuses authoritative film reporting for its financial snapshot", () => {
  assert.match(source, /`\/reports\/movies\/\$\{selectedFinancialMovieId\}`/);
  assert.match(source, /showtime\.showtimeId === editingShowtimeId/);
  assert.match(source, /Showtime financial snapshot/);
  assert.match(source, /Ticket face value/);
  assert.match(source, /F&B revenue/);
  assert.match(source, /Cinema film share/);
  assert.match(source, /Distributor share/);
  assert.match(source, /awaits distributor terms/);
});
