const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/signage/page.tsx"), "utf8");

test("signage serializes refreshes and cancels the active request on teardown", () => {
  assert.match(source, /if \(refreshPendingRef\.current\) return/);
  assert.match(source, /signal: requestController\.signal/);
  assert.match(source, /if \(!requestController\.signal\.aborted\)/);
  assert.match(source, /controller\?\.abort\(\)/);
});
