const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/memberships/page.tsx"), "utf8");

test("membership plans can be fully edited with stable retries", () => {
  assert.match(source, /beginPlanEdit/);
  assert.match(source, /Save plan/);
  assert.match(source, /priceCents: Math\.round\(Number\(planDraft\.price\) \* 100\)/);
  assert.match(source, /benefitsFairMarketValueCents: Math\.round\(Number\(planDraft\.benefitsFairMarketValue\) \* 100\)/);
  assert.match(source, /durationMonths: Number\(planDraft\.duration\)/);
  assert.match(source, /planUpdateAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": planUpdateAttemptRef\.current\.requestId/);
  assert.match(source, /planCreateAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /planToggleAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /mutationLockRef\.current/);
});

test("membership plans capture benefit value for contribution disclosure", () => {
  assert.match(source, /Benefits' fair-market value/);
  assert.match(source, /potentially tax-deductible portion/);
  assert.match(source, /plan\.priceCents - plan\.benefitsFairMarketValueCents/);
});

test("membership plans show active enrollment and paid performance", () => {
  assert.match(source, /activeMemberCount/);
  assert.match(source, /paidPurchaseCount/);
  assert.match(source, /paidRevenueCents/);
  assert.match(source, /online revenue/);
});
