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
  assert.match(source, /stalePayments/);
  assert.match(source, /staleRefunds/);
  assert.match(source, /managerReviewTabs/);
  assert.match(source, /expiredHoldBacklog/);
  assert.match(source, /Payment failure · 7d/);
  assert.match(source, /Refund rate · 7d/);
  assert.match(source, /prior 7d:/);
});

test("Ringo Master surfaces the same urgent remittance risks as Operations", () => {
  assert.match(source, /Urgent operations/i);
  assert.match(source, /!remittance\.collectionOwner/);
  assert.match(source, /remittance\.nextFollowUpAt/);
  assert.match(source, /remittanceAge\(remittance\.dueDate\) > 60/);
  assert.match(source, /href="\/operations\?priority=Urgent"/);
  assert.match(source, /urgentRemittances\.reduce\(\(total, remittance\) => total \+ remittance\.platformShareCents/);
  assert.match(source, /urgentExposureCents/);
  assert.match(source, /urgentUnassignedCount/);
  assert.match(source, /urgentOverdueFollowUpCount/);
  assert.match(source, /urgentCriticalAgingCount/);
});
