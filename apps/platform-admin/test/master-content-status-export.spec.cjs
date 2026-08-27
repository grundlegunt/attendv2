const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../app/content/page.tsx"), "utf8");

test("Master filters and exports operator publication status", () => {
  assert.match(source, /contentFilter/);
  assert.match(source, /Unpublished changes/);
  assert.match(source, /Never published/);
  assert.match(source, /Published and current/);
  assert.match(source, /function exportContentStatus/);
  assert.match(source, /ringo-master-content-status-/);
  assert.match(source, /onClick=\{exportContentStatus\}/);
});
