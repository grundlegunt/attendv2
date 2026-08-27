const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../app/branding/page.tsx"), "utf8");

test("Master filters and exports operator brand readiness", () => {
  assert.match(source, /brandFilter/);
  assert.match(source, /Unpublished drafts/);
  assert.match(source, /Setup needed/);
  assert.match(source, /function exportBrandReadiness/);
  assert.match(source, /ringo-master-brand-readiness-/);
  assert.match(source, /Customer colors/);
  assert.match(source, /Admin colors/);
  assert.match(source, /onClick=\{exportBrandReadiness\}/);
});
