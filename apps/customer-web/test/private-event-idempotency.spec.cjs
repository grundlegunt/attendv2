const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/private-events/page.tsx"), "utf8");

test("private event retries reuse a stable idempotency key", () => {
  assert.match(source, /inquiryAttemptRef = useRef/);
  assert.match(source, /fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": inquiryAttemptRef\.current\.requestId/);
  assert.match(source, /reason\.status < 500/);
});

test("private event form blocks duplicate submissions while pending", () => {
  assert.match(source, /if \(pending\) return/);
  assert.match(source, /disabled=\{pending\}/);
});
