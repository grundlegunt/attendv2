const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/search/page.tsx"), "utf8");

test("customer history offers manager-only external membership maintenance", () => {
  assert.match(source, /employee\.permissions\.includes\("ticket\.price\.edit"\)/);
  assert.match(source, /\/management\/customers\/\$\{customerHistory\.id\}\/membership/);
  assert.match(source, /membershipAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": membershipAttemptRef\.current\.requestId/);
  assert.match(source, /Attend does not sell or renew memberships/);
});
