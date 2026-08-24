const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const catalog = readFileSync(resolve(__dirname, "../app/film-series/page.tsx"), "utf8");
const detail = readFileSync(resolve(__dirname, "../app/film-series/[id]/page.tsx"), "utf8");

test("film-series financial performance is discoverable only to permitted operators", () => {
  assert.match(catalog, /employee\.permissions\.includes\("reports\.view\.financial"\)/);
  assert.match(catalog, /href=\{`\/film-series\/\$\{series\.id\}`\}/);
  assert.match(catalog, />View performance<\/Link>/);
});

test("film-series detail loads authenticated all-time and period performance", () => {
  assert.match(detail, /`\/reports\/film-series\/\$\{id\}`/);
  assert.match(detail, /accessToken/);
  assert.match(detail, /type Period = "all" \| "30" \| "90" \| "365"/);
  assert.match(detail, /FILM SERIES PERFORMANCE/);
});

test("film-series detail exposes programming and financial drilldowns", () => {
  for (const label of ["Performances", "Tickets sold", "Ticket face value", "Distributor share", "Film performance", "Every showtime"]) {
    assert.ok(detail.includes(label), `${label} should be visible on the series detail`);
  }
  assert.match(detail, /F&amp;B revenue/);
  assert.match(detail, /averageShowtimesPerWeek/);
  assert.match(detail, /averageTicketsPerShow/);
  assert.match(detail, /cinemaRevenueCents/);
  assert.match(detail, /distributorRevenueCents/);
});

test("film-series showtimes expose sold-seat maps", () => {
  assert.match(detail, /ShowtimeTicketMap/);
  assert.match(detail, /showtimeId=\{showtime\.showtimeId\}/);
  assert.match(detail, /accessToken=\{accessToken\}/);
});

test("film-series films link to their individual performance reports", () => {
  assert.match(detail, /href=\{`\/films\/\$\{encodeURIComponent\(movie\.movieId\)\}`\}/);
  assert.match(detail, /View performance for \$\{movie\.title\}/);
});

test("film-series performance can be exported for the selected period", () => {
  assert.match(detail, /apiDownload/);
  assert.match(detail, /\/reports\/film-series\/\$\{id\}\/performance\.csv/);
  assert.match(detail, /Export CSV/);
});

test("film-series performance shows attendance and run metrics", () => {
  assert.match(detail, /Attendance/);
  assert.match(detail, /attendancePercent/);
  assert.match(detail, /totalCapacity/);
  assert.match(detail, /Average ticket/);
  assert.match(detail, /Series run/);
});

test("film-series film rows compare attendance", () => {
  assert.match(detail, /Tickets \/ attendance/);
  assert.match(detail, /movie\.attendancePercent/);
  assert.match(detail, /movie\.totalCapacity/);
});
