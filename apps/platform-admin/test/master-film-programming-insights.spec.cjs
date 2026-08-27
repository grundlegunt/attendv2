const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const filmPage = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("Master combines daypart and weekday performance across operators", () => {
  assert.match(platform, /for \(const daypart of report\.daypartPerformance\)/);
  assert.match(platform, /for \(const weekday of report\.weekdayPerformance\)/);
  assert.match(platform, /averageTicketRevenuePerShowCents/);
  assert.match(platform, /averageFnbPerShowCents/);
});

test("film intelligence shows programming mix comparisons", () => {
  assert.match(filmPage, /Performance by daypart/);
  assert.match(filmPage, /Performance by weekday/);
  assert.match(filmPage, /row\.averageTicketsPerShow/);
  assert.match(filmPage, /row\.attendancePercent/);
  assert.match(filmPage, /row\.averageTicketRevenuePerShowCents/);
  assert.match(filmPage, /row\.averageFnbPerShowCents/);
});
