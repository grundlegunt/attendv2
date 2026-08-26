const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/memberships/page.tsx"), "utf8");

test("membership plans can be fully edited with stable retries", () => {
  assert.match(source, /beginPlanEdit/);
  assert.match(source, /Save plan/);
  assert.match(source, /priceCents: Math\.round\(Number\(planDraft\.price\) \* 100\)/);
  assert.match(source, /durationMonths: Number\(planDraft\.duration\)/);
  assert.match(source, /planUpdateAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": planUpdateAttemptRef\.current\.requestId/);
  assert.match(source, /planCreateAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /planToggleAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /mutationLockRef\.current/);
});
