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
  assert.match(source, /Last completed:/);
});

test("payment operations can focus on clients with actual exceptions", () => {
  assert.match(source, /Show exceptions only/);
  assert.match(source, /failedPayments24h \+ organization\.health\.verificationReviews \+ organization\.health\.failedRefunds > 0/);
});
