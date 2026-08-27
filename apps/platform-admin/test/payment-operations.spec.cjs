const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");

test("Attend Master payment operations exposes factual client health", () => {
  assert.match(source, /Failed payments · 24h/);
  assert.match(source, /Payment failure · 7d/);
  assert.match(source, /Refund rate · 7d/);
  assert.match(source, /prior 7d/);
  assert.match(source, /Processing now/);
  assert.match(source, /Payment reviews/);
  assert.match(source, /Failed refunds/);
  assert.match(source, /Stale payments/);
  assert.match(source, /Stale refunds/);
  assert.match(source, /Manager-review tabs/);
  assert.match(source, /Expired seat holds/);
  assert.match(source, /Last completed:/);
});

test("payment operations can focus on clients with actual exceptions", () => {
  assert.match(source, /Show exceptions only/);
  assert.match(source, /showExceptionsOnly && organization\.health\.failedPayments24h \+ organization\.health\.verificationReviews \+ organization\.health\.failedRefunds \+ organization\.health\.stalePayments \+ organization\.health\.staleRefunds \+ organization\.health\.managerReviewTabs \+ organization\.health\.expiredHoldBacklog === 0/);
  assert.match(source, /params\.get\("exceptions"\) === "true"/);
});

test("payment operations can find clients and filter Stripe readiness", () => {
  assert.match(source, /Find client/);
  assert.match(source, /Cinema or legal name/);
  assert.match(source, /Stripe status/);
  assert.match(source, /All statuses/);
  assert.match(source, /Clear filters/);
  assert.match(source, /organization\.payments\.onboardingStatus !== onboardingStatus/);
});

test("payment operations exports the current filtered client view", () => {
  assert.match(source, /function exportPaymentOperations/);
  assert.match(source, /displayedOrganizations\.map/);
  assert.match(source, /ringo-master-payment-operations-/);
  assert.match(source, />Export CSV<\/button>/);
});
