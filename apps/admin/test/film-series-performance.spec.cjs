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
