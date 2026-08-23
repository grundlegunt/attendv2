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
  assert.match(source, /const pendingRef = useRef\(false\)/);
  assert.match(source, /if \(pendingRef\.current\) return; pendingRef\.current = true/);
  assert.match(source, /finally \{ pendingRef\.current = false; setPending\(false\); \}/);
  assert.match(source, /disabled=\{pending\}/);
});

test("private event preferred dates remain calendar dates for server-side resolution", () => {
  assert.match(source, /preferredDate: draft\.preferredDate \|\| undefined/);
  assert.doesNotMatch(source, /new Date\(`\$\{draft\.preferredDate\}T12:00:00`\)\.toISOString\(\)/);
});
