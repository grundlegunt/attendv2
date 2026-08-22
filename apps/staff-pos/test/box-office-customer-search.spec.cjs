const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/box-office-pos.tsx"), "utf8");

test("box-office customer lookup blocks duplicate and sale-overlapping searches", () => {
  assert.match(source, /if \(busyRef\.current \|\| customerSearchPendingRef\.current\) return/);
  assert.match(source, /customerSearchPendingRef\.current = true/);
  assert.match(source, /requestId === customerSearchRequestRef\.current\) \{ customerSearchPendingRef\.current = false/);
  assert.match(source, /customerSearchRequestRef\.current \+= 1;\s*customerSearchPendingRef\.current = false/);
});
