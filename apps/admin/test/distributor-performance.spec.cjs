const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const navigation = readFileSync(resolve(__dirname, "../app/admin-navigation.ts"), "utf8");
const directory = readFileSync(resolve(__dirname, "../app/distributors/page.tsx"), "utf8");
const detail = readFileSync(resolve(__dirname, "../app/distributors/[name]/page.tsx"), "utf8");

test("financial operators can open the distributor directory", () => {
  assert.match(navigation, /href: "\/distributors", label: "Distributors", permissions: \["reports\.view\.financial"\]/);
  assert.match(directory, /apiFetch<Report>\("\/reports\/distributors"/);
  assert.match(directory, /encodeURIComponent\(distributor\.name\)/);
});

test("distributor pages expose sales, allocation, films, and deal history", () => {
  assert.match(detail, /`\/reports\/distributors\/\$\{encodeURIComponent\(name\)\}`/);
  for (const label of ["Distributor share", "Cinema share", "Complete film history", "current", "upcoming", "past", "Deal terms not set"]) assert.ok(detail.includes(label));
  assert.match(detail, /distributorRevenueCents/);
  assert.match(detail, /unallocatedRevenueCents/);
  assert.match(detail, /film\.terms\s*\.map/);
});

test("distributor pages show per-show averages and precise deal percentages", () => {
  for (const label of ["Tickets sold", "average tickets", "average ticket", "F&amp;B revenue", "per show"]) assert.ok(detail.includes(label));
  assert.match(detail, /average\(film\.ticketsSold, film\.showtimes\)/);
  assert.match(detail, /percentage\(term\.distributorShareBasisPoints/);
  assert.match(detail, /maximumFractionDigits: 2/);
});

test("distributor pages show attendance and capacity", () => {
  assert.match(detail, /Attendance/);
  assert.match(detail, /attendancePercent/);
  assert.match(detail, /totalCapacity/);
});

test("distributor pages separate upcoming and completed shows and F&B spend per attendee", () => {
  for (const label of ["Upcoming performances", "Past performances", "F&amp;B per attendee"]) assert.ok(detail.includes(label));
  assert.match(detail, /distributor\.upcomingShowtimes/);
  assert.match(detail, /distributor\.pastShowtimes/);
  assert.match(detail, /distributor\.fnbRevenueCents \/ distributor\.ticketsSold/);
});

test("distributor directory compares portfolio attendance", () => {
  assert.match(directory, /Tickets \/ attendance/);
  assert.match(directory, /distributor\.attendancePercent/);
  assert.match(directory, /distributor\.totalCapacity/);
});

test("distributor directory compares ticket and F&B revenue", () => {
  assert.match(directory, /Ticket \/ F&amp;B/);
  assert.match(directory, /distributor\.ticketRevenueCents/);
  assert.match(directory, /distributor\.fnbRevenueCents/);
});

test("distributor performance can be exported for the selected period", () => {
  assert.match(detail, /apiDownload\(/);
  assert.match(detail, /\/reports\/distributors\/\$\{encodeURIComponent\(name\)\}\/performance\.csv/);
  assert.match(detail, /Export CSV/);
});
