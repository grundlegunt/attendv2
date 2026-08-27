const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const filmPage = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("Master combines operator film performance into theatrical weeks", () => {
  assert.match(platform, /for \(const week of report\.weeklyPerformance\)/);
  assert.match(platform, /weeklyPerformance\.set\(week\.theatricalWeek, current\)/);
  assert.match(platform, /averageTicketsPerShow: week\.showtimes/);
  assert.match(platform, /averageFnbPerShowCents: week\.showtimes/);
});

test("the Master film workspace displays the weekly revenue and attendance trend", () => {
  assert.match(filmPage, /Performance by theatrical week/);
  assert.match(filmPage, /week\.attendancePercent/);
  assert.match(filmPage, /week\.ticketRevenueCents/);
  assert.match(filmPage, /week\.fnbRevenueCents/);
  assert.match(filmPage, /week\.distributorRevenueCents/);
  assert.match(filmPage, /week\.cinemaRevenueCents/);
});
