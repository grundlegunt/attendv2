const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/operations/page.tsx"), "utf8");

test("Master provides a prioritized cross-operator operations queue", () => {
  assert.match(source, /Operations Queue/);
  assert.match(source, /Failed payments in the last 24 hours/);
  assert.match(source, /Payments awaiting verification/);
  assert.match(source, /Overdue remittance follow-ups/);
  assert.match(source, /Failed refunds/);
  assert.match(source, /Expired seat holds awaiting cleanup/);
  assert.match(source, /Missing \$\{missing\.join/);
  assert.match(source, /right\.priority - left\.priority/);
});

test("operations queue supports focused resolution workflows", () => {
  assert.match(source, /Search queue/);
  assert.match(source, /All categories/);
  assert.match(source, /Affected clients/);
  assert.match(source, /Resolve →/);
  assert.match(source, /\/payments\?organizationId=/);
  assert.match(source, /locationId=/);
});
