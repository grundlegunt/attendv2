const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const detail = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");
const dashboard = readFileSync(resolve(__dirname, "../app/admin-dashboard.tsx"), "utf8");
const reports = readFileSync(resolve(__dirname, "../app/management-dashboard.tsx"), "utf8");
const scheduling = readFileSync(resolve(__dirname, "../app/scheduling-calendar.tsx"), "utf8");

test("film performance is linked from operator workflows", () => {
  assert.match(dashboard, /href=\{`\/films\/\$\{encodeURIComponent\(film\.movieId\)\}`\}/);
  assert.match(reports, /href=\{`\/films\/\$\{encodeURIComponent\(row\.movieId\)\}`\}/);
  assert.match(scheduling, /href=\{`\/films\/\$\{encodeURIComponent\(selectedLibraryMovie\.id\)\}`\}/);
});

test("film performance loads authenticated period reports", () => {
  assert.match(detail, /`\/reports\/movies\/\$\{id\}`/);
  assert.match(detail, /type Period = "all" \| "30" \| "90" \| "365"/);
  assert.match(detail, /reports\.view\.financial/);
});

test("film performance exposes attendance, revenue, allocation, and showtime detail", () => {
  for (const metric of ["Performances", "Tickets sold", "Attendance", "Ticket face value", "Cinema film share", "First showing", "Every showtime"]) assert.ok(detail.includes(metric));
  assert.match(detail, /F&amp;B revenue/);
  assert.match(detail, /averageShowtimesPerWeek/);
  assert.match(detail, /averageFnbPerTicketCents/);
  assert.match(detail, /distributorRevenueCents/);
});
