const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/search/page.tsx"), "utf8");

test("customer history offers manager-only membership plan maintenance", () => {
  assert.match(source, /employee\.permissions\.includes\("ticket\.price\.edit"\)/);
  assert.match(source, /\/management\/customers\/\$\{customerHistory\.id\}\/membership/);
  assert.match(source, /membershipAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": membershipAttemptRef\.current\.requestId/);
  assert.match(source, /\/management\/membership-plans/);
  assert.match(source, /planId: membershipPlanId \|\| null/);
  assert.match(source, /Attach a configured Ringo membership plan/);
});
