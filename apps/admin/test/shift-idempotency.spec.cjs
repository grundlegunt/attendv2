const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("manager shift corrections retain a stable retry identity", () => {
  assert.match(source, /shiftAdjustmentAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": shiftAdjustmentAttemptRef\.current\.requestId/);
  assert.match(source, /reason\.status < 500/);
});
