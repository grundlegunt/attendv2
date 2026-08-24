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
  assert.match(detail, /\/reports\/showtimes\/\$\{showtimeId\}\/ticket-map/);
  assert.match(detail, /View ticket map/);
  assert.match(detail, /sold-seat-ledger/);
  assert.match(detail, /Performance by theatrical week/);
  assert.match(detail, /weeklyPerformance/);
  assert.match(detail, /averageFnbPerShowCents/);
  assert.match(detail, /Admission types/);
  assert.match(detail, /Sales channels/);
  assert.match(detail, /admissionTypes/);
  assert.match(detail, /salesChannels/);
  assert.match(detail, /Promotions, comps &amp; refunds/);
  assert.match(detail, /complimentaryTickets/);
  assert.match(detail, /refundedTicketValueCents/);
  assert.match(detail, /performance\.promotions/);
  assert.match(detail, /Performance by auditorium/);
  assert.match(detail, /Performance by daypart/);
  assert.match(detail, /auditoriumPerformance/);
  assert.match(detail, /daypartPerformance/);
  assert.match(detail, /Performance by weekday/);
  assert.match(detail, /weekdayPerformance/);
  assert.match(detail, /apiDownload/);
  assert.match(detail, /performance\.csv/);
  assert.match(detail, /Export CSV/);
});

test("film performance shows the advance-sales booking curve", () => {
  assert.match(detail, /How far ahead audiences buy/);
  assert.match(detail, /performance\.advanceSales\.map/);
  assert.match(detail, /average hours ahead/);
  assert.match(detail, /average days ahead/);
  assert.match(detail, /bucket\.percentOfTickets/);
});
