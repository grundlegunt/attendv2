const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const calendar = fs.readFileSync(path.join(__dirname, "../app/scheduling-calendar.tsx"), "utf8");
const scheduling = fs.readFileSync(path.join(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("selected showtimes expose bulk ticket-group and sale-status controls", () => {
  assert.match(calendar, /Keep ticket group/);
  assert.match(calendar, /Keep sale status/);
  assert.match(calendar, /Apply changes/);
  assert.match(calendar, /onBulkUpdate\(selected/);
});

test("bulk showtime updates retain one idempotency key while retrying", () => {
  assert.match(scheduling, /bulkShowtimeAttemptRef/);
  assert.match(scheduling, /cinema\/showtimes\/bulk/);
  assert.match(scheduling, /"Idempotency-Key": bulkShowtimeAttemptRef\.current\.requestId/);
  assert.match(scheduling, /expectedUpdatedAt: showtime\.updatedAt/);
});
