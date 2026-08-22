const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");

test("ticket receipt retries block duplicate submissions immediately", () => {
  assert.match(source, /if \(!confirmation \|\| receiptRetryPendingRef\.current\) return/);
  assert.match(source, /receiptRetryPendingRef\.current = true/);
  assert.match(source, /finally \{\s*receiptRetryPendingRef\.current = false/);
  assert.match(source, /disabled=\{receiptRetryPending\}/);
});
