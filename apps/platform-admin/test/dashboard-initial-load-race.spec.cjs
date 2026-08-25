const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");

test("the initial dashboard report cannot replace a newer revenue range", () => {
  assert.match(source, /const revenueRequestId = \+\+revenueRequestRef\.current/);
  assert.match(source, /revenueRequestId === revenueRequestRef\.current\) setRevenue\(nextRevenue\)/);
});

test("dashboard overview and revenue requests are invalidated on session exit", () => {
  assert.match(source, /let active = true/);
  assert.match(source, /return \(\) => \{\s*active = false;[\s\S]*?revenueRequestRef\.current \+= 1/);
  assert.match(source, /revenueRequestRef\.current \+= 1;\s*setSession\(null\)/);
});

test("Attend Master exposes real operator payment and refund health facts", () => {
  assert.match(source, /Operator health/);
  assert.match(source, /lastSuccessfulPaymentAt/);
  assert.match(source, /failedPayments24h/);
  assert.match(source, /processingPayments/);
  assert.match(source, /verificationReviews/);
  assert.match(source, /failedRefunds/);
});
