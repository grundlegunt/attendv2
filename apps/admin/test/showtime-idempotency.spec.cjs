const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("showtime creation retains stable retry identities", () => {
  assert.match(source, /showtimeAttemptRef = useRef/);
  assert.match(source, /quickShowtimeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": showtimeAttemptRef\.current!/);
  assert.match(source, /"Idempotency-Key": quickShowtimeAttemptRef\.current\.requestId/);
});
