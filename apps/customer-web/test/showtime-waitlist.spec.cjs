const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/components/seat-picker.tsx"), "utf8");

test("sold-out showtimes offer an idempotent waitlist signup", () => {
  assert.match(source, /availability\.counts\.available === 0/);
  assert.match(source, /showtimes\/\$\{showtimeId\}\/waitlist/);
  assert.match(source, /"Idempotency-Key": waitlistAttemptRef\.current\.requestId/);
  assert.match(source, /if \(waitlistPendingRef\.current\) return/);
  assert.match(source, /Availability is not guaranteed/);
});
