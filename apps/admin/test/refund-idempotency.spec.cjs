const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../app/management-controls.tsx"),
  "utf8",
);

test("admin refunds retain an idempotency key for unchanged retries", () => {
  assert.match(source, /const refundAttemptRef = useRef</);
  assert.match(source, /refundAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /const requestId = refundAttemptRef\.current\.requestId/);
  assert.match(source, /reason\.status < 500/);
});

test("admin refunds block duplicate in-flight submissions", () => {
  assert.match(source, /if \(refundPending\) return/);
  assert.match(source, /setRefundPending\(true\)/);
  assert.match(source, /disabled=\{refundPending\}/);
  assert.match(source, /setRefundPending\(false\)/);
});
