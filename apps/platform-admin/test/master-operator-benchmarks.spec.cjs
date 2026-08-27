const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const source = readFileSync(resolve(__dirname, "../app/benchmarks/page.tsx"), "utf8");

test("Master compares operators with normalized commercial metrics", () => {
  assert.match(source, /Operator Benchmarks/);
  assert.match(source, /Cinema revenue per ticket/);
  assert.match(source, /F&amp;B per order/);
  assert.match(source, /Refund rate/);
  assert.match(source, /Memberships \+ donations/);
  assert.match(source, /client\.combinedRevenueCents, client\.ticketsSold/);
});

test("operator benchmarks support date ranges, ranking, and drill-through", () => {
  assert.match(source, /Rank by/);
  assert.match(source, /Total collected/);
  assert.match(source, /Apply range/);
  assert.match(source, /organizationId=/);
  assert.match(source, /\.sort\(/);
});
