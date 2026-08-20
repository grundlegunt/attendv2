const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/auditorium-builder.tsx"), "utf8");

test("auditorium creation retains a stable retry identity", () => {
  assert.match(source, /createAuditoriumAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": createAuditoriumAttemptRef\.current\.requestId/);
  assert.match(source, /reason instanceof ApiRequestError && reason\.status < 500/);
});
