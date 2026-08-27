const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const page = fs.readFileSync(path.resolve(__dirname, "../app/distributors/page.tsx"), "utf8");

test("Master filters distributor engagements by lifecycle and terms readiness", () => {
  assert.match(page, /type DealFilter = "ALL" \| Deal\["status"\] \| "MISSING_TERMS"/);
  assert.match(page, /deal\.status === dealFilter/);
  assert.match(page, /!Array\.isArray\(deal\.terms\) \|\| deal\.terms\.length === 0/);
  assert.match(page, /aria-label="Filter distributor engagements"/);
  assert.match(page, /No engagements match this filter\./);
});
