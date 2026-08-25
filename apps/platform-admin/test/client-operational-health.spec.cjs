const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("client profiles retain the cross-operator health context", () => {
  assert.match(source, /Live operational state/);
  assert.match(source, /Last completed payment:/);
  assert.match(source, /Stale payments/);
  assert.match(source, /Stale refunds/);
  assert.match(source, /Manager-review tabs/);
  assert.match(source, /Expired holds/);
});
